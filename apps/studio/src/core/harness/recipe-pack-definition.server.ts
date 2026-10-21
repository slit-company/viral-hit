import { fingerprint, type Json } from './durable';
import { validateRecipeManifest } from './recipe-library';
import { MAX_PACK_BYTES, packManifestSchema, type PackSummary } from './recipe-packs';
import type { Recipe } from './recipes';

export function validatePack(raw: unknown) {
  const bytes = JSON.stringify(raw);
  if (!bytes || Buffer.byteLength(bytes) > MAX_PACK_BYTES) throw new Error('Recipe pack exceeds 1 MB');
  const parsed = packManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.slice(0, 6).map(issue => (issue.path.length ? issue.path.join('.') + ': ' : '') + issue.message).join('; ');
    throw new Error(raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'viral-hit-pack' ? 'Invalid pack: ' + fields : 'This file is not a Viral Hit pack (' + fields + ')');
  }
  const manifest = parsed.data;
  const recipes: Recipe[] = manifest.recipes.map((recipe, index) => {
    try { return validateRecipeManifest(recipe); }
    catch (error) { throw new Error(`Recipe ${index + 1}: ${error instanceof Error ? error.message : 'invalid'}`); }
  });
  const ids = new Set<string>();
  for (const recipe of recipes) {
    // Namespace IDs by pack. Nested prefixes may overlap, so storage also checks collisions and shared membership.
    if (!recipe.id.startsWith(`${manifest.id}-`)) throw new Error(`Recipe ${recipe.id} must start with "${manifest.id}-"`);
    if (ids.has(recipe.id)) throw new Error(`Duplicate recipe ID in pack: ${recipe.id}`);
    ids.add(recipe.id);
  }
  const { recipes: _, ...meta } = manifest;
  const summary: PackSummary = { ...meta, recipeIds: recipes.map(recipe => recipe.id), digest: fingerprint({ ...meta, recipes } as unknown as Json) };
  return { summary, recipes };
}
