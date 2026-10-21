import {
  openRecipeLibrary,
  recipeDigest,
  RecipeConflictError,
} from './recipe-database.server';
import { recipeSchema, type Recipe } from './recipes';

/** Compare the whole definition under the same transaction that replaces/removes it. */
export function changeInstalledRecipe(
  id: string,
  expectedDigest: string,
  next: Recipe | null,
) {
  const db = openRecipeLibrary()!;
  try {
    db.exec('BEGIN IMMEDIATE');
    const row = db
      .prepare('SELECT manifest FROM recipes WHERE id=?')
      .get(id) as { manifest: string } | undefined;
    const currentDigest = row
      ? recipeDigest(recipeSchema.parse(JSON.parse(row.manifest)))
      : undefined;
    const nextDigest = next ? recipeDigest(next) : undefined;
    if ((!next && !row) || (next && currentDigest === nextDigest)) {
      db.exec('COMMIT');
      return { changed: false };
    }
    if (!row || currentDigest !== expectedDigest)
      throw new RecipeConflictError(
        'Installed recipe changed after review. Review its current definition again.',
      );
    if (next) {
      if (next.id !== id)
        throw new RecipeConflictError('An update must keep the recipe ID');
      db.prepare('UPDATE recipes SET manifest=?, digest=? WHERE id=?').run(
        JSON.stringify(next),
        nextDigest!,
        id,
      );
    } else db.prepare('DELETE FROM recipes WHERE id=?').run(id);
    db.exec('COMMIT');
    return { changed: true };
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
