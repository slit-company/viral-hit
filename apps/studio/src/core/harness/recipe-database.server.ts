import { DatabaseSync } from 'node:sqlite';
import { lstatSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';
import { fingerprint, type Json } from './durable';
import type { Recipe } from './recipes';

export const recipeDigest = (recipe: Recipe) =>
  fingerprint(recipe as unknown as Json);
export class RecipeConflictError extends Error {}

/** One connection policy for installation and lifecycle; reads never create storage. */
export function openRecipeLibrary(readOnly = false) {
  const path = join(getViralHitDataRoot(), 'recipe-library.sqlite');
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (metadata && !metadata.isFile())
    throw new Error('Recipe library is not a regular database file');
  if (readOnly && !metadata) return null;
  if (!readOnly) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { readOnly });
  db.exec('PRAGMA busy_timeout=5000');
  if (!readOnly)
    db.exec(
      'CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, digest TEXT NOT NULL, installed_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS packs (id TEXT PRIMARY KEY, summary TEXT NOT NULL, digest TEXT NOT NULL, installed_at INTEGER NOT NULL)',
    );
  return db;
}
