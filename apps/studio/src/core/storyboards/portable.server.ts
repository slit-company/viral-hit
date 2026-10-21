import { recipeDigest } from '../harness/recipe-database.server';
import { loadRecipes } from '../harness/recipe-registry';
import type { Recipe } from '../harness/recipes';
import { MAX_STORYBOARD_BYTES, type StoryboardState } from './contract';
import { readStoryboardBundleSource, stageStoryboardBundle, shotDigest } from './storage.server';
import { storyboardAttachment, mapStoryboardPlan, validateStoryboardMedia, type StoryboardAttachment, type PortableMedia } from './portable';

export { readStoryboardBundleSource } from './storage.server';
export async function exportStoryboardAttachment(source: ReturnType<typeof readStoryboardBundleSource>): Promise<StoryboardAttachment> {
  if (!source.boards.length) return { boards: [], recipes: [] };
  const definitions = new Map(source.recipes.map(recipe => [recipeDigest(recipe), recipe]));
  const needed = new Set(source.boards.flatMap(board => board.plan.shots.flatMap(shot => shot.recipe ? [shot.recipe.digest] : [])));
  if ([...needed].some(digest => !definitions.has(digest))) for (const recipe of await loadRecipes()) definitions.set(recipeDigest(recipe), recipe);
  const recipes = [...needed].map(digest => {
    const recipe = definitions.get(digest);
    if (!recipe) throw Error('Restore the exact recipe version before exporting this storyboard: ' + digest);
    return recipe;
  });
  return storyboardAttachment.parse({ boards: source.boards.map(state => ({
    id: state.id, sourceRevision: state.revision, plan: state.plan,
    accepted: Object.fromEntries(Object.entries(state.accepted).map(([id, { sourceActionId: _, ...accepted }]) => [id, accepted])),
  })), recipes });
}
function recipeIndex(attachment: StoryboardAttachment) {
  const recipes = new Map<string, Recipe>();
  for (const recipe of attachment.recipes) {
    if (Buffer.byteLength(JSON.stringify(recipe)) > 128_000) throw Error('Bundled recipe exceeds 128 KB');
    const digest = recipeDigest(recipe);
    if (recipes.has(digest)) throw Error('Duplicate bundled recipe definition');
    recipes.set(digest, recipe);
  }
  const needed = new Set(attachment.boards.flatMap(board => board.plan.shots.flatMap(shot => shot.recipe ? [shot.recipe.digest] : [])));
  if (recipes.size !== needed.size || [...recipes.keys()].some(digest => !needed.has(digest))) throw Error('Bundled recipes must match the storyboard requirements');
  return recipes;
}
export function inspectStoryboardAttachment(raw: StoryboardAttachment, media?: PortableMedia[]) {
  const attachment = storyboardAttachment.parse(raw), recipes = recipeIndex(attachment);
  for (const board of attachment.boards) {
    if (Buffer.byteLength(JSON.stringify(board)) > MAX_STORYBOARD_BYTES) throw Error('Bundled storyboard exceeds 256 KB');
    for (const [id, accepted] of Object.entries(board.accepted)) {
      const shot = board.plan.shots.find(shot => shot.id === id);
      if (!shot || accepted.shotDigest !== shotDigest(board.plan, shot)) throw Error('Accepted storyboard inputs changed');
    }
    // Mapping validates missing definitions and declared asset IDs without interpreting free text.
    if (media) {
      mapStoryboardPlan(board.plan, recipes, new Map(media.map(asset => [asset.id, asset.id])));
      validateStoryboardMedia(board, new Map(media.map(asset => [asset.id, asset])), recipes);
    }
  }
  return { storyboardCount: attachment.boards.length,
    acceptedShotCount: attachment.boards.reduce((count, board) => count + Object.keys(board.accepted).length, 0),
    recipeRequirements: [...recipes].map(([digest, recipe]) => ({ id: recipe.id, version: recipe.version, title: recipe.title, digest })) };
}
export function mapStoryboardAttachment(attachment: StoryboardAttachment, projectId: string, ids: Map<string, string>): StoryboardState[] {
  inspectStoryboardAttachment(attachment);
  const recipes = recipeIndex(attachment);
  return attachment.boards.map(board => {
    const plan = mapStoryboardPlan(board.plan, recipes, ids);
    const accepted = Object.fromEntries(Object.entries(board.accepted).map(([id, value]) => {
      const assetId = ids.get(value.assetId); if (!assetId) throw Error('Accepted storyboard media is missing');
      return [id, { ...value, assetId, shotDigest: shotDigest(plan, plan.shots.find(shot => shot.id === id)!) }];
    }));
    return { projectId, id: board.id, revision: 1, plan, accepted };
  });
}
export function stageStoryboardAttachment(attachment: StoryboardAttachment, projectId: string, ids: Map<string, string>) {
  stageStoryboardBundle(projectId, mapStoryboardAttachment(attachment, projectId, ids), attachment.recipes.map(recipe => ({ digest: recipeDigest(recipe), recipe })));
}
