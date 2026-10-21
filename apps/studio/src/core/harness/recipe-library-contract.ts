import type { ModelRequirements } from './model-requirements';
import type { Recipe } from './recipes';
import type { PackSummary } from './recipe-packs';

export type RecipeInspection = {
  recipe: Recipe;
  digest: string;
  collision: 'none' | 'same' | 'different' | 'reserved';
  modelRequirements?: ModelRequirements;
  operations: string[];
  unavailableOperations: string[];
  parameterCount: number;
  nodeCount: number;
  update?: { current: Recipe; digest: string; packs: PackSummary[] };
};
export type RecipeRemovalReview = {
  recipe: Recipe;
  digest: string;
  packs: PackSummary[];
};
export type RecipeCatalog = {
  recipes: Recipe[];
  installedIds: string[];
  recipeDigests: Record<string, string>;
};
