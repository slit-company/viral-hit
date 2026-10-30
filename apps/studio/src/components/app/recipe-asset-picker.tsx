import { Link } from '@/core/i18n/navigation';
import { m as uiMessages } from '@/paraglide/messages.js';
import { eligibleRecipeAssets, type RecipeInputAsset, type AssetCapability } from '@/core/harness/recipe-assets';
import type { Recipe } from '@/core/harness/recipes';

export function RecipeAssetPicker({ id, parameter, recipe, assets, capabilities, value, onChange, projectId }: {
  id: string; parameter: Extract<Recipe['parameters'][number], { type: 'asset' }>; recipe: Recipe;
  assets: RecipeInputAsset[]; capabilities: AssetCapability[]; value: string; onChange: (value: string) => void; projectId: string;
}) {
  const available = eligibleRecipeAssets(recipe, parameter, assets, capabilities);
  const kind = parameter.kind === 'image' ? uiMessages["ui.common.image"]() : parameter.kind === 'video' ? uiMessages["ui.common.video"]() : uiMessages["ui.common.audio"]();
  const selected = available.find(asset => asset.id === value);
  const nativeImage = recipe.nodes.some(node => node.operation === 'comfy.upload' && node.parameters?.some(binding => binding.parameter === parameter.id));
  return <div className="space-y-2">
    <select id={id} value={value} onChange={event => onChange(event.target.value)} className="w-full min-w-0 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)] p-2 text-xs">
      <option value="" disabled>{uiMessages["ui.app.select_media"]({ kind })}</option>
      {available.map(asset => <option key={asset.id} value={asset.id}>{asset.filename ?? asset.id}</option>)}
    </select>
    {selected && (parameter.kind === 'image' ? <img src={selected.publicUrl} alt={uiMessages["ui.app.selected_media"]({ name: parameter.label })} className="h-20 w-full rounded-lg border border-[var(--vh-border)] object-contain" />
      : parameter.kind === 'video' ? <video src={selected.publicUrl} aria-label={uiMessages["ui.app.selected_media"]({ name: parameter.label })} controls preload="metadata" className="max-h-36 w-full rounded-lg" />
      : <audio src={selected.publicUrl} aria-label={uiMessages["ui.app.selected_media"]({ name: parameter.label })} controls preload="metadata" className="h-10 w-full min-w-0" />)}
    <p className="text-[11px] leading-relaxed text-[var(--vh-text-2)]">{available.length ? nativeImage ? uiMessages["ui.app.this_image_will_be_sent_to_your_configured_comfyui_server"]() : uiMessages["ui.app.workflow_media"]({ kind }) : uiMessages["ui.app.no_matching_media"]({ kind })} <Link href={`/assets/${projectId}`} className="underline">{uiMessages["ui.app.open_assets"]()}</Link></p>
  </div>;
}
