import { loadRecipeDirectory } from './recipe-registry';
import { validatePack } from './recipe-pack-definition.server';
import { recipeDigest, RecipeConflictError } from './recipe-database.server';
import { reviewInstalledPack, updateInstalledPack, removeInstalledPack } from './recipe-pack-lifecycle-storage.server';
import { supportedOperations } from './capabilities';
import type { PackUpdateReview } from './recipe-pack-lifecycle-contract';

const reservedIds = async () => (await loadRecipeDirectory()).map(recipe => recipe.id);

export async function reviewPackUpdate(raw: unknown): Promise<PackUpdateReview> {
  const { summary, recipes } = validatePack(raw);
  const state = reviewInstalledPack(summary.id, summary.recipeIds, await reservedIds());
  const supported = supportedOperations();
  const changes = state.members.map(member => {
    const incoming = recipes.find(recipe => recipe.id === member.id);
    const change = !incoming ? member.current ? 'detach' as const : 'missing' as const
      : !member.current ? 'add' as const : recipeDigest(member.current) === recipeDigest(incoming) ? 'same' as const : 'different' as const;
    return { ...member, ...(incoming ? { incoming } : {}), change,
      unavailableOperations: incoming ? [...new Set(incoming.nodes.map(node => node.operation))].filter(operation => !supported.has(operation)) : [] };
  });
  return { ...state, incoming: summary, changes,
    blocking: changes.filter(item => item.incoming && item.reserved).map(item => `${item.id} belongs to the file catalog.`) };
}

export async function updatePack(raw: unknown, expectedDigest: string, expectedStateDigest: string, replaceRecipeIds: string[]) {
  const { summary, recipes } = validatePack(raw);
  if (summary.digest !== expectedDigest) throw new RecipeConflictError('Incoming pack changed after review. Review the current file again.');
  return updateInstalledPack(summary, recipes, expectedStateDigest, replaceRecipeIds, await reservedIds());
}
export async function reviewPackRemoval(id: string) {
  return reviewInstalledPack(id, [], await reservedIds());
}
export async function removePack(id: string, expectedStateDigest: string, deleteRecipeIds: string[]) {
  return removeInstalledPack(id, expectedStateDigest, deleteRecipeIds, await reservedIds());
}
