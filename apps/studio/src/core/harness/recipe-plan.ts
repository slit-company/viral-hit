import { recipeDigest, RecipeConflictError } from './recipe-database.server';
import { supportedOperations } from './capabilities';
import { loadRecipes } from './recipe-registry';
import { compileRecipe, compileRecipeForCheck } from './recipes';
import { runRequest } from './requests';
import { z } from 'zod';
export const recipeCheckRequest = z.object({ recipeId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), values: z.record(z.string(), z.json()), expectedRecipeDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export async function prepareRecipeCheck(recipeId: string, values: Record<string, unknown>, projectId: string, expectedRecipeDigest?: string) {
  const recipe = (await loadRecipes()).find(recipe => recipe.id === recipeId);
  if (!recipe) throw new Error('Recipe not found. Close and reopen Runs to reload the recipe library.');
  if (expectedRecipeDigest && recipeDigest(recipe) !== expectedRecipeDigest) throw new RecipeConflictError('Recipe changed since these inputs were loaded. Close and reopen Runs, review the current definition and inputs, then try again.');
  return compileRecipeForCheck(recipe, values, projectId);
}
export async function prepareRecipePlan(recipeId: string, values: Record<string, unknown>, projectId: string, expectedRecipeDigest?: string) {
  const recipe = (await loadRecipes()).find(recipe => recipe.id === recipeId);
  if (!recipe) throw new Error('Recipe not found. Close and reopen Runs to reload the recipe library.');
  if (expectedRecipeDigest && recipeDigest(recipe) !== expectedRecipeDigest) throw new RecipeConflictError('Recipe changed since these inputs were loaded. Close and reopen Runs, review the current definition and inputs, then try again.');
  const plan = compileRecipe(recipe, values, projectId, supportedOperations());
  // Apply the same execution policy as a direct plan before admitting paid work.
  const validated = runRequest.parse({ action: 'enqueue', requestKey: 'validation-only', nodes: plan.nodes });
  if (validated.action !== 'enqueue') throw new Error('Invalid recipe plan');
  return { projectId, nodes: validated.nodes };
}
