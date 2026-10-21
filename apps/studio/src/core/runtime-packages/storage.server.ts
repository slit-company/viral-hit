import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '@/lib/canonical-json';
import { getViralHitDataRoot } from '@/config/data-root';
import { runtimePackageSchema, type RuntimeEntry, type RuntimePackage, type RuntimePackageSummary } from './contract';

export class RuntimePackageConflictError extends Error {}
export const runtimeDigest = (value: unknown) => createHash('sha256').update(canonicalJson(value as Parameters<typeof canonicalJson>[0])).digest('hex');
export const runtimeEntryId = (entry: RuntimeEntry) => String(entry.kind === 'adapter' ? entry.manifest.operation : entry.manifest.id);
export const runtimeSummary = (pkg: RuntimePackage): RuntimePackageSummary => ({ id: pkg.id, version: pkg.version, title: pkg.title, description: pkg.description,
  author: pkg.author, license: pkg.license, scope: pkg.scope, digest: runtimeDigest(pkg), entries: pkg.entries.map(entry => ({ kind: entry.kind, id: runtimeEntryId(entry), label: String(entry.manifest.label) })) });
function open(write = false) {
  const path = join(getViralHitDataRoot(), 'runtime-packages.sqlite'), info = lstatSync(path, { throwIfNoEntry: false });
  if (info && !info.isFile()) throw new Error('Runtime storage must be a regular file');
  if (!info && !write) return null;
  if (write) mkdirSync(getViralHitDataRoot(), { recursive: true });
  const db = new DatabaseSync(path, { readOnly: !write }); db.exec('PRAGMA busy_timeout=5000');
  if (write) db.exec('CREATE TABLE IF NOT EXISTS releases(id TEXT NOT NULL,digest TEXT NOT NULL,document TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(id,digest)); CREATE TABLE IF NOT EXISTS heads(id TEXT PRIMARY KEY,digest TEXT NOT NULL,revision INTEGER NOT NULL,removed INTEGER NOT NULL)');
  return db;
}
function read(db: DatabaseSync | null, id: string, digest: string) {
  const row = db?.prepare('SELECT document FROM releases WHERE id=? AND digest=?').get(id,digest) as { document: string } | undefined;
  if (!row) throw new Error('Runtime release not found');
  const pkg = runtimePackageSchema.parse(JSON.parse(row.document));
  if (pkg.id !== id || runtimeDigest(pkg) !== digest) throw new Error('Runtime release integrity mismatch');
  return pkg;
}
function heads(db: DatabaseSync | null) {
  const rows = (db?.prepare('SELECT id,digest,revision,removed FROM heads ORDER BY id').all() ?? []) as { id: string; digest: string; revision: number; removed: number }[];
  if (rows.length > 64) throw new Error('At most 64 managed runtime package identities');
  return rows;
}
export function readRuntimeCatalog() {
  const db = open();
  try {
    const state = heads(db);
    return { stateDigest: runtimeDigest(state), heads: state, packages: state.filter(row => !row.removed).map(row => read(db,row.id,row.digest)) };
  } finally { db?.close(); }
}
export function readRuntimeRelease(id: string, digest?: string) {
  const db = open();
  try {
    const head = heads(db).find(row => row.id === id);
    if (!digest && (!head || head.removed)) throw new Error('Active runtime package not found');
    return read(db,id,digest ?? head!.digest);
  } finally { db?.close(); }
}
export function runtimeHistory(id: string) {
  const db = open();
  try {
    const head = heads(db).find(row => row.id === id);
    const rows = (db?.prepare('SELECT digest FROM releases WHERE id=? ORDER BY created_at DESC,digest').all(id) ?? []) as { digest: string }[];
    return { id, currentDigest: head && !head.removed ? head.digest : null, releases: rows.map(row => runtimeSummary(read(db,id,row.digest))) };
  } finally { db?.close(); }
}
function checkCapacity(packages: RuntimePackage[]) {
  for (const kind of ['adapter','provider','publishing']) {
    const entries = packages.flatMap(pkg => pkg.entries.filter(entry => entry.kind === kind));
    if (entries.length > 32 || entries.reduce((sum,entry) => sum + Buffer.byteLength(entry.source),0) > 8_000_000) throw new Error('Managed '+kind+' capacity exceeded (32 entries / 8 MB source)');
    if (new Set(entries.map(runtimeEntryId)).size !== entries.length) throw new RuntimePackageConflictError('Managed runtime identity already belongs to another package');
  }
  const models = packages.flatMap(pkg => pkg.entries.filter(entry => entry.kind === 'provider').flatMap(entry => (entry.manifest.models as { id: string }[]).map(model => model.id)));
  if (new Set(models).size !== models.length) throw new RuntimePackageConflictError('A model ID belongs to another managed provider');
}
export function commitRuntimePackage(id: string, expectedStateDigest: string, pkg: RuntimePackage | null) {
  const db = open(true)!;
  try {
    db.exec('BEGIN IMMEDIATE'); const state = heads(db), head = state.find(row => row.id === id);
    if (runtimeDigest(state) !== expectedStateDigest) throw new RuntimePackageConflictError('Runtime packages changed after review. Inspect again.');
    if (!pkg && (!head || head.removed)) throw new RuntimePackageConflictError('Runtime package is no longer active');
    if (pkg) {
      if (pkg.id !== id) throw new Error('Runtime package identity mismatch');
      checkCapacity([...state.filter(row => !row.removed && row.id !== id).map(row => read(db,row.id,row.digest)),pkg]);
      if (!head && state.length >= 64) throw new Error('At most 64 managed runtime package identities');
      const digest = runtimeDigest(pkg), document = JSON.stringify(pkg);
      if (!db.prepare('SELECT 1 FROM releases WHERE id=? AND digest=?').get(id,digest)) {
        const bytes = db.prepare('SELECT COALESCE(SUM(length(CAST(document AS BLOB))),0) AS n FROM releases').get() as { n: number };
        if (bytes.n + Buffer.byteLength(document) > 128 * 1024 * 1024) throw new Error('Retained runtime releases exceed 128 MiB');
        db.prepare('INSERT INTO releases VALUES(?,?,?,?)').run(id,digest,document,Date.now());
      }
    }
    db.prepare('INSERT INTO heads VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET digest=excluded.digest,revision=excluded.revision,removed=excluded.removed').run(id,pkg ? runtimeDigest(pkg) : head!.digest,(head?.revision ?? 0)+1,pkg ? 0 : 1);
    db.exec('COMMIT');
  } catch(error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
