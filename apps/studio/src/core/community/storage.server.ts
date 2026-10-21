import { DatabaseSync } from 'node:sqlite';
import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { communityCatalogSchema, type SavedCatalog } from './contract';

export class CatalogConflictError extends Error {}
function open(readOnly = false) {
  const path = join(getViralHitDataRoot(), 'community-catalogs.sqlite');
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info && !info.isFile())
    throw new Error('Catalog storage must be a regular file');
  if (readOnly && !info) return null;
  mkdirSync(getViralHitDataRoot(), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { readOnly });
  db.exec('PRAGMA busy_timeout=5000');
  if (!readOnly)
    db.exec(
      'CREATE TABLE IF NOT EXISTS catalogs (id TEXT PRIMARY KEY, digest TEXT NOT NULL, document TEXT NOT NULL, source TEXT, updated_at TEXT NOT NULL)',
    );
  return db;
}
export function readCatalogs(): SavedCatalog[] {
  const db = open(true);
  if (!db) return [];
  try {
    if (
      !db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalogs'",
        )
        .get()
    )
      return [];
    const rows = db
      .prepare(
        'SELECT digest, document, source, updated_at FROM catalogs ORDER BY id',
      )
      .all() as {
      digest: string;
      document: string;
      source: string | null;
      updated_at: string;
    }[];
    return rows.map((row) => ({
      catalog: communityCatalogSchema.parse(JSON.parse(row.document)),
      digest: row.digest,
      ...(row.source ? { source: row.source } : {}),
      updatedAt: row.updated_at,
    }));
  } finally {
    db.close();
  }
}
export function saveCatalog(
  next: SavedCatalog,
  expectedPreviousDigest: string | null,
) {
  const db = open()!;
  try {
    db.exec('BEGIN IMMEDIATE');
    const current = db
      .prepare('SELECT digest FROM catalogs WHERE id=?')
      .get(next.catalog.id) as { digest: string } | undefined;
    if (current?.digest === next.digest) {
      db.exec('COMMIT');
      return { changed: false };
    }
    if ((current?.digest ?? null) !== expectedPreviousDigest)
      throw new CatalogConflictError(
        'Catalog changed after review. Review it again.',
      );
    const document = JSON.stringify(next.catalog);
    const capacity = db
      .prepare(
        'SELECT count(*) AS count, coalesce(sum(length(CAST(document AS BLOB))),0) AS bytes FROM catalogs WHERE id<>?',
      )
      .get(next.catalog.id) as { count: number; bytes: number };
    if (
      capacity.count >= 20 ||
      capacity.bytes + Buffer.byteLength(document) > 8 * 1024 * 1024
    )
      throw new Error(
        'Catalog library limit reached: 20 catalogs or 8 MiB of metadata',
      );
    db.prepare(
      'INSERT INTO catalogs (id,digest,document,source,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET digest=excluded.digest,document=excluded.document,source=excluded.source,updated_at=excluded.updated_at',
    ).run(
      next.catalog.id,
      next.digest,
      document,
      next.source ?? null,
      next.updatedAt,
    );
    db.exec('COMMIT');
    return { changed: true };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
export function removeCatalog(id: string, expectedDigest: string) {
  const db = open(true);
  if (!db) return { removed: false };
  db.close();
  const writable = open()!;
  try {
    writable.exec('BEGIN IMMEDIATE');
    const current = writable
      .prepare('SELECT digest FROM catalogs WHERE id=?')
      .get(id) as { digest: string } | undefined;
    if (current && current.digest !== expectedDigest)
      throw new CatalogConflictError(
        'Catalog changed after review. Reload before removing it.',
      );
    writable.prepare('DELETE FROM catalogs WHERE id=?').run(id);
    writable.exec('COMMIT');
    return { removed: !!current };
  } catch (error) {
    if (writable.isTransaction) writable.exec('ROLLBACK');
    throw error;
  } finally {
    writable.close();
  }
}
