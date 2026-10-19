import { supportedOperations } from './capabilities';
import { loadRecipes } from './recipe-registry';
import { compileRecipe, compileRecipeForCheck } from './recipes';
import { runRequest } from './requests';
import { z } from 'zod';
export const recipeCheckRequest = z.object({ recipeId: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), values: z.record(z.string(), z.json()) }).strict();
export async function prepareRecipeCheck(recipeId: string, values: Record<string, unknown>, projectId: string) {
  const recipe = (await loadRecipes()).find(recipe => recipe.id === recipeId);
  if (!recipe) throw new Error('Recipe not found');
  return compileRecipeForCheck(recipe, values, projectId);
}
export async function prepareRecipePlan(recipeId: string, values: Record<string, unknown>, projectId: string) {
  const recipe = (await loadRecipes()).find(recipe => recipe.id === recipeId);
  if (!recipe) throw new Error('Recipe not found');
  const plan = compileRecipe(recipe, values, projectId, supportedOperations);
  // Apply the same execution policy as a direct plan before admitting paid work.
  const validated = runRequest.parse({ action: 'enqueue', requestKey: 'validation-only', nodes: plan.nodes });
  if (validated.action !== 'enqueue') throw new Error('Invalid recipe plan');
  return { projectId, nodes: validated.nodes };
}
