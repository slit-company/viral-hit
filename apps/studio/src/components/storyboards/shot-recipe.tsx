import type { StoryboardShot } from '@/core/storyboards/contract';
import type { RecipeCatalog } from '@/core/harness/recipe-library-contract';
import type { Recipe } from '@/core/harness/recipes';
import { assetOperationKind, isAssetOperation } from '@/core/harness/asset-operations';
import { RecipeParameterForm } from '@/components/app/recipe-parameter-form';
import type { AssetCapability } from '@/core/harness/recipe-assets';
import type { BoardAsset } from './use-storyboards';
import { SelectField } from './fields';

export function shotOutputs(recipe: Recipe) {
  return recipe.nodes.filter(node => isAssetOperation(node.operation, node.input) && ['image', 'video'].includes(String(assetOperationKind(node.operation, node.input))));
}
export function ShotRecipe({ projectId, shot, catalog, assets, capabilities, change }: {
  projectId: string; shot: StoryboardShot; catalog: RecipeCatalog; assets: BoardAsset[]; capabilities: AssetCapability[]; change: (shot: StoryboardShot) => void;
}) {
  const selected = catalog.recipes.find(recipe => recipe.id === shot.recipe?.id);
  const stale = !!shot.recipe && (!selected || catalog.recipeDigests[shot.recipe.id] !== shot.recipe.digest);
  return <section className="space-y-4" aria-label="Shot recipe">
    <SelectField label="Generation recipe" value={shot.recipe?.id ?? ''} onChange={id => {
      const recipe = catalog.recipes.find(item => item.id === id);
      change({ ...shot, recipe: recipe ? { id, digest: catalog.recipeDigests[id], values: Object.fromEntries(recipe.parameters.filter(p => p.default !== undefined).map(p => [p.id, p.default!])), outputNodeId: shotOutputs(recipe)[0].id } : undefined });
    }}><option value="">Use existing project media</option>{stale && !selected && <option value={shot.recipe!.id}>{shot.recipe!.id} · unavailable</option>}{catalog.recipes.filter(recipe => shotOutputs(recipe).length).map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.title} · {recipe.id}</option>)}</SelectField>
    {stale && <p role="alert" className="rounded-lg bg-amber-100 p-3 text-sm text-amber-950">This recipe changed or is unavailable. Choose a current recipe and review its inputs before saving. Existing attempts keep their original inputs.</p>}
    {selected && shot.recipe && !stale && <>
      <p className="text-sm leading-6 text-[var(--vh-text-2)]">{selected.description}</p>
      <SelectField label="Shot output" value={shot.recipe.outputNodeId} onChange={outputNodeId => change({ ...shot, recipe: { ...shot.recipe!, outputNodeId } })}>{shotOutputs(selected).map(node => <option key={node.id} value={node.id}>{node.id} · {node.operation}</option>)}</SelectField>
      <RecipeParameterForm recipe={selected} values={Object.fromEntries(Object.entries(shot.recipe.values).filter((entry): entry is [string, string | number | boolean] => ['string', 'number', 'boolean'].includes(typeof entry[1])))} assets={assets} capabilities={capabilities} projectId={projectId} hasCheck={false} onChange={(key, value) => change({ ...shot, recipe: { ...shot.recipe!, values: { ...shot.recipe!.values, [key]: value } } })} />
      <p className="text-xs leading-5 text-[var(--vh-text-2)]">These are the execution inputs. Map your direction into the recipe fields explicitly. Generation can use credits on the configured provider.</p>
    </>}
  </section>;
}
