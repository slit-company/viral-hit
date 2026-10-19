import type { Recipe } from './recipes';

export type RecipeInputAsset = { id: string; type: string; storageProvider: string; filename: string | null; publicUrl: string; mimeType: string | null; sizeBytes: number | null };
export type AssetCapability = { operation: string; assetInputs?: { id: string; pointer: string; kind: 'image' | 'video' | 'audio'; maxBytes: number }[] };
/** Client-side eligibility only; admission and worker independently verify project membership and bytes. */
export function eligibleRecipeAssets(recipe: Recipe, parameter: Extract<Recipe['parameters'][number], { type: 'asset' }>, assets: RecipeInputAsset[], capabilities: AssetCapability[]) {
  const consumers = recipe.nodes.flatMap(node => (node.parameters ?? []).filter(binding => binding.parameter === parameter.id).map(binding => ({ node, binding })));
  return assets.filter(asset => {
    if (asset.type !== parameter.kind || asset.storageProvider !== 'local' || !asset.sizeBytes || asset.sizeBytes > 512 * 1024 * 1024) return false;
    return consumers.every(({ node, binding }) => {
      if (node.operation === 'comfy.upload') return asset.type === 'image' && ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType ?? '') && asset.sizeBytes! <= 32 * 1024 * 1024;
      const input = capabilities.find(capability => capability.operation === node.operation)?.assetInputs?.find(input => input.pointer === binding.target);
      return !input || (input.kind === asset.type && asset.sizeBytes! <= input.maxBytes);
    });
  });
}
