import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { characterSchema, type Character } from './contract';

export class CharacterConflictError extends Error {}
const root = () => join(getViralHitDataRoot(), 'characters');
const database = () => join(getViralHitDataRoot(), 'character-library.sqlite');
const SCHEMA = 'CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, version INTEGER NOT NULL, status TEXT NOT NULL, document TEXT NOT NULL, updated_at INTEGER NOT NULL)';

function regularOrMissing(path: string) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info && (info.isSymbolicLink() || !(info.isFile() || info.isDirectory()))) throw new Error('Character storage path is not a regular file or folder');
}
function open(readOnly = false) {
  const path = database(); regularOrMissing(path);
  if (readOnly && !existsSync(path)) return null;
  mkdirSync(getViralHitDataRoot(), { recursive: true });
  const db = new DatabaseSync(path, { readOnly });
  db.exec('PRAGMA busy_timeout=5000');
  if (!readOnly) db.exec(SCHEMA);
  return db;
}

export function referencePath(sha256: string) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid reference');
  regularOrMissing(root());
  const path = join(root(), sha256); regularOrMissing(path);
  return path;
}

/** Content-addressed and shared by every character; an existing file with the same hash is reused. */
export async function storeReferenceBytes(sha256: string, bytes: Uint8Array) {
  const path = referencePath(sha256);
  if ((await stat(path).catch(() => null))?.size === bytes.byteLength && createHash('sha256').update(await readFile(path)).digest('hex') === sha256) return path;
  mkdirSync(root(), { recursive: true, mode: 0o700 });
  const temporary = join(root(), '.' + randomUUID() + '.tmp');
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
  return path;
}

export function readCharacters(includeArchived = false): Character[] {
  const db = open(true); if (!db) return [];
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='characters'").get()) return [];
    const rows = db.prepare('SELECT document FROM characters ' + (includeArchived ? '' : "WHERE status='active' ") + 'ORDER BY updated_at DESC LIMIT 500').all() as { document: string }[];
    return rows.map(row => characterSchema.parse(JSON.parse(row.document)));
  } finally { db.close(); }
}
export function readCharacter(id: string): Character | null {
  const db = open(true); if (!db) return null;
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='characters'").get()) return null;
    const row = db.prepare('SELECT document FROM characters WHERE id=?').get(id) as { document: string } | undefined;
    return row ? characterSchema.parse(JSON.parse(row.document)) : null;
  } finally { db.close(); }
}

/** Revision-checked write; expectedVersion 0 creates a new character. */
export function writeCharacter(next: Character, expectedVersion: number) {
  const parsed = characterSchema.parse(next);
  const db = open()!;
  try {
    db.exec('BEGIN IMMEDIATE');
    const row = db.prepare('SELECT version FROM characters WHERE id=?').get(parsed.id) as { version: number } | undefined;
    if (expectedVersion === 0 && row) throw new CharacterConflictError('A character with this ID already exists');
    if (!row && expectedVersion > 0) throw new CharacterConflictError('Character not found');
    if (row && row.version !== expectedVersion) throw new CharacterConflictError('This character changed since you opened it. Reload and try again.');
    if (parsed.version !== expectedVersion + 1) throw new Error('Character version must advance by one');
    db.prepare('INSERT INTO characters (id, version, status, document, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version, status=excluded.status, document=excluded.document, updated_at=excluded.updated_at')
      .run(parsed.id, parsed.version, parsed.status, JSON.stringify(parsed), Date.parse(parsed.updatedAt));
    db.exec('COMMIT');
    return parsed;
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}

