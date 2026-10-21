import { modelRecipeDefinition } from './model-recipe-contract';
import { listModelRecipeModels, buildModelRecipe } from './model-recipe.server';
import { changeInstalledRecipe } from './recipe-lifecycle-storage.server';
import type { RecipeInspection, RecipeRemovalReview } from './recipe-library-contract';
import { z } from 'zod';
import { compileRecipeForCheck, recipeSchema } from './recipes';
import { loadRecipeDirectory, loadRecipes } from './recipe-registry';
import { recipeDigest, storeInstalledRecipe, readInstalledPacks, readInstalledRecipes, RecipeConflictError } from './recipe-storage';
import { fingerprint, type Json } from './durable';
import { inspectComfyGraph, importComfyRecipe, comfyRecipeDefinitionSchema } from './import-comfy-recipe';
import { supportedOperations } from './capabilities';

export const recipeLibraryRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('model_catalog') }).strict(),
  z.object({ action: z.literal('build_model'), definition: modelRecipeDefinition, expectedModelDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('inspect_graph'), graph: z.unknown() }).strict(),
  z.object({ action: z.literal('convert_graph'), graph: z.unknown(), definition: comfyRecipeDefinitionSchema, expectedGraphDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('inspect'), manifest: z.unknown() }).strict(),
  z.object({ action: z.literal('get'), recipeId: recipeSchema.shape.id }).strict(),
  z.object({ action: z.literal('review-remove'), recipeId: recipeSchema.shape.id }).strict(),
  z.object({ action: z.literal('remove'), recipeId: recipeSchema.shape.id, expectedDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('update'), manifest: z.unknown(), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/), expectedInstalledDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('install'), manifest: z.unknown(), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

export function validateRecipeManifest(raw: unknown) {
  // Count before parsing; schemas may add defaults, so also bound the saved form.
  const bytes = JSON.stringify(raw);
  if (!bytes || Buffer.byteLength(bytes) > 128_000) throw new Error('Recipe manifest exceeds 128 KB');
  const recipe = recipeSchema.parse(raw);
  if (Buffer.byteLength(JSON.stringify(recipe)) > 128_000) throw new Error('Recipe manifest exceeds 128 KB');
  compileRecipeForCheck(recipe, {}, 'recipe-inspection-only');
  return recipe;
}

export async function inspectRecipe(raw: unknown): Promise<RecipeInspection> {
  const recipe = validateRecipeManifest(raw);
  const digest = recipeDigest(recipe);
  const base = await loadRecipeDirectory();
  const existing = (await loadRecipes()).find(item => item.id === recipe.id);
  const collision = base.some(item => item.id === recipe.id) ? 'reserved'
    : existing ? recipeDigest(existing) === digest ? 'same' : 'different' : 'none';
  const operations = [...new Set(recipe.nodes.map(node => node.operation))];
  return { recipe, digest, collision, operations, unavailableOperations: operations.filter(operation => !supportedOperations().has(operation)),
    parameterCount: recipe.parameters.length, nodeCount: recipe.nodes.length,
    ...(collision === 'different' && existing ? { update: { current: existing, digest: recipeDigest(existing), packs: readInstalledPacks().filter(pack => pack.recipeIds.includes(recipe.id)) } } : {}) };
}

export async function installRecipe(raw: unknown, expectedDigest: string) {
  const recipe = validateRecipeManifest(raw);
  if (recipeDigest(recipe) !== expectedDigest) throw new RecipeConflictError('Recipe changed after inspection. Inspect the current JSON again.');
  if ((await loadRecipeDirectory()).some(item => item.id === recipe.id)) throw new RecipeConflictError('This ID belongs to the file catalog. Use a new ID to preserve the original.');
  return storeInstalledRecipe(recipe);
}

export function inspectRecipeGraph(graph: unknown) {
  const bytes = JSON.stringify(graph);
  if (!bytes || Buffer.byteLength(bytes) > 128_000) throw new Error('API graph exceeds 128 KB');
  const nodes = inspectComfyGraph(graph);
  return { nodes, graphDigest: fingerprint(graph as Json) };
}

/** Shared offline authoring boundary for HTTP and MCP; conversion never installs or executes. */
export async function changeRecipeLibrary(raw: z.infer<typeof recipeLibraryRequest>) {
  const request = recipeLibraryRequest.parse(raw);
  switch (request.action) {
    case 'model_catalog': return { models: listModelRecipeModels() };
    case 'build_model': return inspectRecipe(buildModelRecipe(request.definition, request.expectedModelDigest));
    case 'inspect': return inspectRecipe(request.manifest);
    case 'get': { const recipe = (await loadRecipes()).find(recipe => recipe.id === request.recipeId); if (!recipe) throw new Error('Recipe not found'); return { recipe, digest: recipeDigest(recipe) }; }
    case 'review-remove': return reviewRecipeRemoval(request.recipeId);
    case 'remove': {
      await assertInstalledId(request.recipeId);
      return { removed: changeInstalledRecipe(request.recipeId, request.expectedDigest, null).changed, recipeId: request.recipeId };
    }
    case 'update': {
      const recipe = validateRecipeManifest(request.manifest);
      if (recipeDigest(recipe) !== request.expectedDigest) throw new RecipeConflictError('Recipe changed after inspection. Inspect the current JSON again.');
      await assertInstalledId(recipe.id);
      return { updated: changeInstalledRecipe(recipe.id, request.expectedInstalledDigest, recipe).changed, recipe, digest: request.expectedDigest };
    }
    case 'install': return installRecipe(request.manifest, request.expectedDigest);
    case 'inspect_graph': return inspectRecipeGraph(request.graph);
    case 'convert_graph': {
      const inspected = inspectRecipeGraph(request.graph);
      if (inspected.graphDigest !== request.expectedGraphDigest) throw new RecipeConflictError('API graph changed after inspection. Inspect it again.');
      return inspectRecipe(importComfyRecipe(request.graph, request.definition));
    }
  }
}

async function assertInstalledId(id: string) {
  if ((await loadRecipeDirectory()).some(recipe => recipe.id === id)) throw new RecipeConflictError('This ID belongs to the file catalog. Use a new ID to preserve the original.');
}
async function reviewRecipeRemoval(id: string): Promise<RecipeRemovalReview> {
  await assertInstalledId(id);
  const recipe = readInstalledRecipes().find(recipe => recipe.id === id);
  if (!recipe) throw new RecipeConflictError('Installed recipe not found');
  return { recipe, digest: recipeDigest(recipe), packs: readInstalledPacks().filter(pack => pack.recipeIds.includes(id)) };
}
