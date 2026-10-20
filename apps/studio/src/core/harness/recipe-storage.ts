import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getViralHitDataRoot } from '../../config/data-root';
import { fingerprint, type Json } from './durable';
import { recipeSchema, type Recipe } from './recipes';
import { packSummarySchema, type InstalledPack, type PackSummary } from './recipe-packs';

const file = () => join(getViralHitDataRoot(), 'recipe-library.sqlite');
function assertFile(path: string) {
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (!metadata) return;
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Recipe library is not a regular database file');
}
export const recipeDigest = (recipe: Recipe) => fingerprint(recipe as unknown as Json);
export class RecipeConflictError extends Error {}
const SCHEMA = 'CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, digest TEXT NOT NULL, installed_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS packs (id TEXT PRIMARY KEY, summary TEXT NOT NULL, digest TEXT NOT NULL, installed_at INTEGER NOT NULL)';

export function readInstalledRecipes(): Recipe[] {
  const path = file(); assertFile(path);
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const rows = db.prepare('SELECT id, manifest FROM recipes ORDER BY id LIMIT 201').all() as { id: string; manifest: string }[];
    if (rows.length > 200) throw new Error('Recipe library exceeds 200 manifests');
    return rows.map(row => {
      if (Buffer.byteLength(row.manifest) > 128_000) throw new Error('Recipe manifest exceeds 128 KB');
      const recipe = recipeSchema.parse(JSON.parse(row.manifest));
      if (recipe.id !== row.id) throw new Error('Recipe library identity mismatch');
      return recipe;
    });
  } finally { db.close(); }
}

export function readInstalledPacks(): InstalledPack[] {
  const path = file(); assertFile(path);
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='packs'").get()) return [];
    const rows = db.prepare('SELECT id, summary, digest, installed_at FROM packs ORDER BY id LIMIT 201').all() as { id: string; summary: string; digest: string; installed_at: number }[];
    return rows.map(row => {
      const summary = packSummarySchema.parse(JSON.parse(row.summary));
      if (summary.id !== row.id || summary.digest !== row.digest) throw new Error('Recipe pack identity mismatch');
      return { ...summary, installedAt: row.installed_at };
    });
  } finally { db.close(); }
}

/**
 * Installs every recipe of a pack or none of them. Identical recipes already
 * present are kept; any different recipe or pack contents reject the whole pack.
 */
export function storeInstalledPack(summary: PackSummary, recipes: Recipe[]) {
  const path = file(); assertFile(path); mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout=5000; ${SCHEMA}; BEGIN IMMEDIATE`);
    const current = db.prepare('SELECT digest FROM packs WHERE id=?').get(summary.id) as { digest: string } | undefined;
    if (current) {
      if (current.digest !== summary.digest) throw new RecipeConflictError('This pack ID is already installed with different contents. Publish an update under a new pack ID.');
      db.exec('COMMIT'); return { pack: summary, installed: false, added: [] as string[] };
    }
    const added: Recipe[] = [];
    for (const recipe of recipes) {
      const row = db.prepare('SELECT manifest FROM recipes WHERE id=?').get(recipe.id) as { manifest: string } | undefined;
      if (!row) { added.push(recipe); continue; }
      if (recipeDigest(recipeSchema.parse(JSON.parse(row.manifest))) !== recipeDigest(recipe)) throw new RecipeConflictError(`Recipe ${recipe.id} already has different contents.`);
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM recipes').get() as { n: number };
    if (count.n + added.length > 200) throw new RecipeConflictError('The local library cannot hold this pack (200 recipes).');
    const now = Date.now(), insert = db.prepare('INSERT INTO recipes (id,manifest,digest,installed_at) VALUES (?,?,?,?)');
    for (const recipe of added) insert.run(recipe.id, JSON.stringify(recipe), recipeDigest(recipe), now);
    db.prepare('INSERT INTO packs (id,summary,digest,installed_at) VALUES (?,?,?,?)').run(summary.id, JSON.stringify(summary), summary.digest, now);
    db.exec('COMMIT'); return { pack: summary, installed: true, added: added.map(recipe => recipe.id) };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
}


/** Immutable installation: SQLite serializes limits/collisions across app and MCP processes. */
export function storeInstalledRecipe(recipe: Recipe) {
  const path = file(); assertFile(path); mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout=5000; ${SCHEMA}; BEGIN IMMEDIATE`);
    const digest = recipeDigest(recipe);
    const current = db.prepare('SELECT manifest FROM recipes WHERE id=?').get(recipe.id) as { manifest: string } | undefined;
    if (current) {
      if (recipeDigest(recipeSchema.parse(JSON.parse(current.manifest))) !== digest) throw new RecipeConflictError('This recipe ID already has different contents. Use a new ID for a fork or revision.');
      db.exec('COMMIT'); return { recipe, digest, installed: false };
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM recipes').get() as { n: number };
    if (count.n >= 200) throw new RecipeConflictError('The local library is full (200 recipes).');
    db.prepare('INSERT INTO recipes (id,manifest,digest,installed_at) VALUES (?,?,?,?)').run(recipe.id, JSON.stringify(recipe), digest, Date.now());
    db.exec('COMMIT'); return { recipe, digest, installed: true };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
}
