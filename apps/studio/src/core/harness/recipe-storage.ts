import { openRecipeLibrary, recipeDigest, RecipeConflictError } from './recipe-database.server';
export { recipeDigest, RecipeConflictError } from './recipe-database.server';
import { fingerprint, type Json } from './durable';
import { recipeSchema, type Recipe } from './recipes';
import { packSummarySchema, type InstalledPack, type PackSummary } from './recipe-packs';

export function readInstalledRecipes(): Recipe[] {
  const db = openRecipeLibrary(true); if (!db) return [];
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
  const db = openRecipeLibrary(true); if (!db) return [];
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='packs'").get()) return [];
    db.exec('BEGIN');
    const recipeRows = db.prepare('SELECT id, manifest FROM recipes').all() as { id: string; manifest: string }[];
    const recipes = new Map(recipeRows.map(row => [row.id, recipeSchema.parse(JSON.parse(row.manifest))]));
    const rows = db.prepare('SELECT id, summary, digest, installed_at FROM packs ORDER BY id LIMIT 201').all() as { id: string; summary: string; digest: string; installed_at: number }[];
    return rows.map(row => {
      const summary = packSummarySchema.parse(JSON.parse(row.summary));
      if (summary.id !== row.id || summary.digest !== row.digest) throw new Error('Recipe pack identity mismatch');
      const missingRecipeIds = summary.recipeIds.filter(id => !recipes.has(id));
      const { recipeIds, digest, ...meta } = summary;
      const unchanged = !missingRecipeIds.length && fingerprint({ ...meta, recipes: recipeIds.map(id => recipes.get(id)!) } as unknown as Json) === digest;
      return { ...summary, installedAt: row.installed_at, content: { state: missingRecipeIds.length ? 'missing' as const : unchanged ? 'complete' as const : 'modified' as const, missingRecipeIds } };
    });
  } finally { db.close(); }
}

/**
 * Installs every recipe of a pack or none of them. Identical recipes already
 * present are kept; any different recipe or pack contents reject the whole pack.
 */
export function storeInstalledPack(summary: PackSummary, recipes: Recipe[]) {
  const db = openRecipeLibrary()!;
  try {
    db.exec('BEGIN IMMEDIATE');
    const current = db.prepare('SELECT digest FROM packs WHERE id=?').get(summary.id) as { digest: string } | undefined;
    if (current) {
      if (current.digest !== summary.digest) throw new RecipeConflictError('This pack ID is already installed with different contents. Review a pack update to maintain this ID.');
    }
    if (!current && (db.prepare('SELECT COUNT(*) AS n FROM packs').get() as { n: number }).n >= 200) throw new RecipeConflictError('The local library is full (200 packs).');
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
    if (!current) db.prepare('INSERT INTO packs (id,summary,digest,installed_at) VALUES (?,?,?,?)').run(summary.id, JSON.stringify(summary), summary.digest, now);
    db.exec('COMMIT'); return { pack: summary, installed: !current, added: added.map(recipe => recipe.id) };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
}


/** New installation never overwrites existing contents: SQLite serializes limits/collisions across app and MCP processes. */
export function storeInstalledRecipe(recipe: Recipe) {
  const db = openRecipeLibrary()!;
  try {
    db.exec('BEGIN IMMEDIATE');
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
