import { DatabaseSync } from 'node:sqlite';
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { MAX_INSTRUCTIONS_BYTES, MAX_MANIFEST_BYTES, viralHitSkillIdSchema, type ViralHitSkillDefinition } from './contract';
import { type SkillPackage } from './package';
import { SkillConflictError, skillDigest, validateSkillFile } from './file.server';

type Row = { id: string; digest: string; document: string | null };
const MAX_LIBRARY_BYTES = 32 * 1024 * 1024;
const SCHEMA = 'CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, digest TEXT NOT NULL, document TEXT, updated_at INTEGER NOT NULL)';
function open(readOnly = false) {
  const path = join(getViralHitDataRoot(), 'skill-library.sqlite');
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info && !info.isFile()) throw new Error('Skill database must be a regular file');
  if (readOnly && !existsSync(path)) return null;
  mkdirSync(getViralHitDataRoot(), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { readOnly });
  db.exec('PRAGMA busy_timeout=5000');
  if (!readOnly) db.exec(SCHEMA);
  return db;
}
function readLegacyText(path: string, maximum: number) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.size > maximum) throw new Error('Invalid legacy skill file');
    const text = readFileSync(fd);
    if (text.byteLength > maximum) throw new Error('Invalid legacy skill file');
    return text.toString('utf8');
  } finally { closeSync(fd); }
}
function legacySkill(id: string): SkillPackage | null {
  const root = join(getViralHitDataRoot(), 'installed-skills');
  const folder = join(root, id), info = lstatSync(folder, { throwIfNoEntry: false });
  if (!info) return null;
  if (!lstatSync(root).isDirectory() || !info.isDirectory()) throw new Error('Invalid legacy skill folder');
  const file = validateSkillFile({ schemaVersion: 1, kind: 'viral-hit-skill',
    manifest: JSON.parse(readLegacyText(join(folder, 'skill.json'), MAX_MANIFEST_BYTES)),
    instructions: readLegacyText(join(folder, 'SKILL.md'), MAX_INSTRUCTIONS_BYTES) });
  if (file.manifest.id !== id) throw new Error('Legacy skill ID does not match its folder');
  return file;
}

/** Database rows supersede legacy folders; a tombstone keeps an uninstalled legacy skill absent. */
export function readManagedSkills(): { id: string; definition: ViralHitSkillDefinition | null }[] {
  const db = open(true); if (!db) return [];
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='skills'").get()) return [];
    return (db.prepare('SELECT id, digest, document FROM skills ORDER BY id').all() as Row[]).map(row => {
      if (row.document === null) return { id: row.id, definition: null };
      const file = validateSkillFile(JSON.parse(row.document));
      if (file.manifest.id !== row.id || skillDigest(file) !== row.digest) throw new Error('Installed skill storage is inconsistent');
      return { id: row.id, definition: { ...file, source: 'installed' as const } };
    });
  } finally { db.close(); }
}

/** Compare and replace the whole definition in one SQLite transaction, shared by every process. */
export function writeManagedSkill(id: string, expectedDigest: string | null, next: SkillPackage | null): boolean {
  viralHitSkillIdSchema.parse(id);
  if (next && next.manifest.id !== id) throw new Error('Skill ID cannot change during replacement');
  const db = open()!;
  try {
    db.exec('BEGIN IMMEDIATE');
    const row = db.prepare('SELECT id, digest, document FROM skills WHERE id=?').get(id) as Row | undefined;
    const legacy = row ? null : legacySkill(id);
    const currentDigest = row ? row.document === null ? null : row.digest : legacy ? skillDigest(legacy) : null;
    const nextDigest = next ? skillDigest(next) : null;
    // Retries converge only to the requested contents, or to removal of the same reviewed revision.
    if ((next && currentDigest === nextDigest) || (!next && row?.document === null && row.digest === expectedDigest)) {
      db.exec('COMMIT'); return false;
    }
    if (currentDigest !== expectedDigest || (!next && !currentDigest)) throw new SkillConflictError('Installed skill changed after review. Review it again.');
    const document = next ? JSON.stringify(next) : null;
    const capacity = db.prepare('SELECT count(*) AS count, coalesce(sum(length(CAST(document AS BLOB))),0) AS bytes FROM skills WHERE id<>?').get(id) as { count: number; bytes: number };
    if (!row && capacity.count >= 500) throw new Error('The managed skill library is limited to 500 IDs');
    if (document && capacity.bytes + Buffer.byteLength(document) > MAX_LIBRARY_BYTES) throw new Error('The managed skill library is limited to 32 MiB');
    db.prepare('INSERT INTO skills (id,digest,document,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET digest=excluded.digest,document=excluded.document,updated_at=excluded.updated_at')
      .run(id, nextDigest ?? expectedDigest!, document, Date.now());
    db.exec('COMMIT'); return true;
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
