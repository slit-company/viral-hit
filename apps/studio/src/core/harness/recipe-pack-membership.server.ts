import { openRecipeLibrary, recipeDigest, RecipeConflictError } from './recipe-database.server';
import { recipeSchema } from './recipes';
import type { InstalledPack, PackSummary } from './recipe-packs';

/** Composition lifecycle changes membership only after each library operation succeeds. */
export function commitRecipePackMembership(id: string, previous: InstalledPack | null, next: PackSummary | null, members: { id: string; digest: string | null }[]) {
  const db = openRecipeLibrary()!;
  try {
    db.exec('BEGIN IMMEDIATE');
    const current = db.prepare('SELECT digest,installed_at FROM packs WHERE id=?').get(id) as { digest: string; installed_at: number } | undefined;
    if ((current?.digest ?? null) !== (previous?.digest ?? null) || (current?.installed_at ?? null) !== (previous?.installedAt ?? null)) throw new RecipeConflictError('Recipe pack membership changed after review.');
    for (const member of members) {
      const row = db.prepare('SELECT manifest FROM recipes WHERE id=?').get(member.id) as { manifest: string } | undefined;
      if ((row ? recipeDigest(recipeSchema.parse(JSON.parse(row.manifest))) : null) !== member.digest) throw new RecipeConflictError('Recipe changed before updating pack membership: ' + member.id);
    }
    if (next) {
      if (next.id !== id || next.recipeIds.some(recipeId => !members.some(member => member.id === recipeId && member.digest))) throw new RecipeConflictError('Recipe pack contains unavailable members.');
      if (!current && (db.prepare('SELECT COUNT(*) AS n FROM packs').get() as { n: number }).n >= 200) throw new RecipeConflictError('The local library is full (200 packs).');
      db.prepare('INSERT INTO packs VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary,digest=excluded.digest').run(id, JSON.stringify(next), next.digest, current?.installed_at ?? Date.now());
    } else db.prepare('DELETE FROM packs WHERE id=?').run(id);
    db.exec('COMMIT');
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
