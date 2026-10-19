import { z } from 'zod';
import { compileRecipeForCheck, recipeSchema } from './recipes';
import { loadRecipeDirectory, loadRecipes } from './recipe-registry';
import { recipeDigest, storeInstalledRecipe, RecipeConflictError } from './recipe-storage';
import { fingerprint, type Json } from './durable';
import { inspectComfyGraph, importComfyRecipe, comfyRecipeDefinitionSchema } from './import-comfy-recipe';
import { supportedOperations } from './capabilities';

export const recipeLibraryRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect_graph'), graph: z.unknown() }).strict(),
  z.object({ action: z.literal('convert_graph'), graph: z.unknown(), definition: comfyRecipeDefinitionSchema, expectedGraphDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('inspect'), manifest: z.unknown() }).strict(),
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

export async function inspectRecipe(raw: unknown) {
  const recipe = validateRecipeManifest(raw);
  const digest = recipeDigest(recipe);
  const base = await loadRecipeDirectory();
  const existing = (await loadRecipes()).find(item => item.id === recipe.id);
  const collision = base.some(item => item.id === recipe.id) ? 'reserved'
    : existing ? recipeDigest(existing) === digest ? 'same' : 'different' : 'none';
  const operations = [...new Set(recipe.nodes.map(node => node.operation))];
  return { recipe, digest, collision, operations, unavailableOperations: operations.filter(operation => !supportedOperations().has(operation)),
    parameterCount: recipe.parameters.length, nodeCount: recipe.nodes.length };
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
export async function changeRecipeLibrary(request: z.infer<typeof recipeLibraryRequest>) {
  switch (request.action) {
    case 'inspect': return inspectRecipe(request.manifest);
    case 'install': return installRecipe(request.manifest, request.expectedDigest);
    case 'inspect_graph': return inspectRecipeGraph(request.graph);
    case 'convert_graph': {
      const inspected = inspectRecipeGraph(request.graph);
      if (inspected.graphDigest !== request.expectedGraphDigest) throw new RecipeConflictError('API graph changed after inspection. Inspect it again.');
      return inspectRecipe(importComfyRecipe(request.graph, request.definition));
    }
  }
}
