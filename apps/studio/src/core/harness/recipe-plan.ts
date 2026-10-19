import { loadRecipes } from './recipe-registry';
import { compileRecipe } from './recipes';
import { runRequest } from './requests';
export async function prepareRecipePlan(recipeId: string, values: Record<string, unknown>, projectId: string) {
  const recipe = (await loadRecipes()).find(recipe => recipe.id === recipeId);
  if (!recipe) throw new Error('Recipe not found');
  const plan = compileRecipe(recipe, values, projectId, new Set(['comfy.router']));
  // Apply the same execution policy as a direct plan before admitting paid work.
  const validated = runRequest.parse({ action: 'enqueue', requestKey: 'validation-only', nodes: plan.nodes });
  if (validated.action !== 'enqueue') throw new Error('Invalid recipe plan');
  return { projectId, nodes: validated.nodes };
}
