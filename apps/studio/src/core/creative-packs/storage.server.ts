import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { MAX_CREATIVE_MANIFEST_BYTES, type CreativePackManifest } from './contract';
import { summarizeCreativePack, validateCreativeManifest } from './manifest.server';

export class CreativePackConflictError extends Error {}
const root = () => join(getViralHitDataRoot(), 'creative-packs');
const MAX_STORED_BYTES = 64 * 1024 * 1024;
const validId = (id: string) => { if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw new Error('Invalid pack ID'); return id; };
function legacy(id: string) {
  let fd;
  try { fd = openSync(join(root(), validId(id) + '.json'), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > MAX_CREATIVE_MANIFEST_BYTES) throw new Error('Invalid installed pack file');
    const manifest = validateCreativeManifest(JSON.parse(readFileSync(fd, 'utf8')));
    if (manifest.id !== id) throw new Error('Creative pack identity mismatch');
    return manifest;
  } finally { closeSync(fd); }
}
function open(readOnly = false) {
  const path = join(getViralHitDataRoot(), 'creative-pack-library.sqlite'), info = lstatSync(path, { throwIfNoEntry: false });
  if (info && !info.isFile()) throw new Error('Creative pack storage is not a regular file');
  if (readOnly && !info) return null;
  if (!readOnly) mkdirSync(getViralHitDataRoot(), { recursive: true });
  const db = new DatabaseSync(path, { readOnly }); db.exec('PRAGMA busy_timeout=5000');
  if (!readOnly) db.exec('CREATE TABLE IF NOT EXISTS releases (id TEXT NOT NULL,digest TEXT NOT NULL,manifest TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(id,digest)); CREATE TABLE IF NOT EXISTS heads (id TEXT PRIMARY KEY,digest TEXT NOT NULL,revision INTEGER NOT NULL,removed INTEGER NOT NULL)');
  return db;
}
function release(db: DatabaseSync | null, id: string, digest: string) {
  const row = db?.prepare('SELECT manifest FROM releases WHERE id=? AND digest=?').get(id, digest) as { manifest: string } | undefined;
  if (!row) return null;
  const manifest = validateCreativeManifest(JSON.parse(row.manifest));
  if (manifest.id !== id || summarizeCreativePack(manifest).digest !== digest) throw new Error('Creative release identity mismatch');
  return manifest;
}
function state(db: DatabaseSync | null, id: string) {
  validId(id);
  const head = db?.prepare('SELECT digest,revision,removed FROM heads WHERE id=?').get(id) as { digest: string; revision: number; removed: number } | undefined;
  if (head) {
    const last = release(db, id, head.digest);
    if (!last) throw new Error('Creative release is missing');
    return { manifest: head.removed ? null : last, last, revision: 'managed:' + head.revision, generation: head.revision };
  }
  const manifest = legacy(id);
  return { manifest, last: manifest, revision: manifest ? 'legacy:' + summarizeCreativePack(manifest).digest : 'absent', generation: 0 };
}
export async function readCreativePackState(id: string) {
  const db = open(true); try { return state(db, id); } finally { db?.close(); }
}
export async function readStoredCreativePack(id: string, digest?: string) {
  const db = open(true);
  try {
    if (!digest) return state(db, id).manifest;
    validId(id);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid release digest');
    const retained = release(db, id, digest); if (retained) return retained;
    const old = legacy(id); return old && summarizeCreativePack(old).digest === digest ? old : null;
  } finally { db?.close(); }
}
function ids(db: DatabaseSync | null) {
  let names: string[] = [];
  try { names = readdirSync(root()).filter(name => /^[a-z][a-z0-9-]{0,39}\.json$/.test(name)).map(name => name.slice(0, -5)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const managed = db?.prepare('SELECT id FROM heads').all() as { id: string }[] | undefined;
  const result = [...new Set([...names, ...(managed ?? []).map(row => row.id)])].sort();
  if (result.length > 500) throw new Error('Too many creative packs'); return result;
}
export async function listStoredCreativePacks(removed = false) {
  const db = open(true);
  try { return ids(db).flatMap(id => { const current = state(db, id), manifest = removed ? !current.manifest && current.last : current.manifest; return manifest ? [summarizeCreativePack(manifest)] : []; }); }
  finally { db?.close(); }
}
export async function listCreativePackHistory(id: string) {
  validId(id); const db = open(true);
  try {
    const current = state(db, id), old = legacy(id);
    const rows = db?.prepare('SELECT digest FROM releases WHERE id=? ORDER BY created_at DESC,digest').all(id) as { digest: string }[] | undefined;
    const versions = (rows ?? []).map(row => summarizeCreativePack(release(db, id, row.digest)!));
    if (old && !versions.some(item => item.digest === summarizeCreativePack(old).digest)) versions.push(summarizeCreativePack(old));
    return { id, currentDigest: current.manifest ? summarizeCreativePack(current.manifest).digest : null, releases: versions };
  } finally { db?.close(); }
}
function saveRelease(db: DatabaseSync, manifest: CreativePackManifest) {
  const summary = summarizeCreativePack(manifest);
  if (release(db, manifest.id, summary.digest)) return;
  const json = JSON.stringify(manifest), bytes = db.prepare('SELECT COALESCE(SUM(length(CAST(manifest AS BLOB))),0) AS n FROM releases').get() as { n: number };
  if (bytes.n + Buffer.byteLength(json) > MAX_STORED_BYTES) throw new Error('Retained creative-pack metadata exceeds 64 MiB. Export releases before managing storage.');
  db.prepare('INSERT INTO releases VALUES (?,?,?,?)').run(manifest.id, summary.digest, json, Date.now());
}
function commit(id: string, expectedRevision: string | undefined, next: CreativePackManifest | null, installing = false) {
  const db = open()!;
  try {
    db.exec('BEGIN IMMEDIATE'); const current = state(db, id);
    if (installing && current.manifest) {
      if (summarizeCreativePack(current.manifest).digest !== summarizeCreativePack(next!).digest) throw new CreativePackConflictError('A different creative pack has this ID');
      db.exec('COMMIT'); return { changed: false };
    }
    if (!installing && current.revision !== expectedRevision) throw new CreativePackConflictError('Creative pack changed after review. Inspect its current state again.');
    if (!next && !current.manifest) { db.exec('COMMIT'); return { changed: false }; }
    if (next && (validateCreativeManifest(next).id !== id)) throw new Error('Creative pack identity mismatch');
    if (!current.last && ids(db).length >= 500) throw new Error('Too many creative packs');
    if (current.last) saveRelease(db, current.last);
    if (next) saveRelease(db, next);
    const digest = summarizeCreativePack(next ?? current.last!).digest;
    db.prepare('INSERT INTO heads VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET digest=excluded.digest,revision=excluded.revision,removed=excluded.removed').run(id, digest, current.generation + 1, next ? 0 : 1);
    db.exec('COMMIT'); return { changed: true };
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
/** Retained releases never change; only the reviewed active pointer does. */
export async function commitCreativePack(id: string, expectedRevision: string, next: CreativePackManifest | null) { return commit(id, expectedRevision, next); }
export async function storeCreativePack(manifest: CreativePackManifest) { return commit(manifest.id, undefined, manifest, true); }
