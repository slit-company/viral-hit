/**
 * Compatibility shim: ViralHit code uses `await getDb()` (async),
 * TanStack uses `db()` (sync). This adapter lets ViralHit code work unchanged.
 *
 * Usage in migrated ViralHit files:
 *   import { getDb } from '@/core/workspace-lib/db-adapter';
 *   const db = await getDb();
 *   await db.select(...)
 */
import { db } from '@/core/db';

export async function getDb() {
  return db();
}
