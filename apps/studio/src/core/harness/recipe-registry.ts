import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readInstalledRecipes } from './recipe-storage';
import { recipeSchema, type Recipe } from './recipes';

export async function loadRecipeDirectory(directory = process.env.VIRAL_HIT_RECIPES_DIR || resolve(process.cwd(), '../../recipes')): Promise<Recipe[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => resolve(directory, e.name));
  if (paths.length > 200) throw new Error('Recipe directory contains too many manifests');
  const result: Recipe[] = [];
  const ids = new Set<string>();
  for (const path of paths.sort()) {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128_000) throw new Error('Invalid recipe manifest file');
    const bytes = await readFile(path);
    if (bytes.byteLength > 128_000) throw new Error('Recipe manifest exceeds 128 KB');
    const recipe = recipeSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (ids.has(recipe.id)) throw new Error(`Duplicate recipe id: ${recipe.id}`);
    ids.add(recipe.id); result.push(recipe);
  }
  return result;
}

/** Explicit directories retain the offline/file-only contract used by CLI tooling. */
export async function loadRecipes(directory?: string): Promise<Recipe[]> {
  const base = await loadRecipeDirectory(directory);
  if (directory !== undefined) return base;
  const installed = readInstalledRecipes();
  const ids = new Set(base.map(recipe => recipe.id));
  for (const recipe of installed) {
    if (ids.has(recipe.id)) throw new Error(`Duplicate recipe id: ${recipe.id}`);
    ids.add(recipe.id);
  }
  return [...base, ...installed];
}
