import { m as uiMessages } from '@/paraglide/messages.js';
import { TextField } from '@seed-design/react';
import type { Recipe } from '@/core/harness/recipes';
import type { RecipeInputAsset, AssetCapability } from '@/core/harness/recipe-assets';
import { RecipeAssetPicker } from './recipe-asset-picker';

type Props = {
  recipe: Recipe;
  values: Record<string, string | number | boolean>;
  assets: RecipeInputAsset[];
  capabilities: AssetCapability[];
  projectId: string;
  hasCheck: boolean;
  onChange: (parameterId: string, value: string | number | boolean) => void;
};

export function RecipeParameterForm({ recipe, values, assets, capabilities, projectId, hasCheck, onChange }: Props) {
  return (
            <div className={`${hasCheck ? 'sm:max-h-[min(18rem,calc(85vh-38rem))]' : 'sm:max-h-[min(28rem,calc(85vh-26rem))]'} space-y-4 overflow-y-auto pr-1`} aria-label={uiMessages["ui.app.recipe_parameters"]()}>
            {recipe.parameters.map(parameter => {
              const id = `recipe-${parameter.id}`;
              const value = values[parameter.id] ?? parameter.default ?? '';
              const change = (value: string | number | boolean) => onChange(parameter.id, value);
              const fieldClass = 'w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] p-3 text-sm outline-none focus:border-[var(--vh-border-strong)]';
              return <div key={id} className="space-y-2"><label htmlFor={id} className="block text-xs text-[var(--vh-text-2)]">{parameter.label}</label>
                {parameter.type === 'asset' ? <RecipeAssetPicker id={id} parameter={parameter} recipe={recipe} assets={assets} capabilities={capabilities} value={String(value)} onChange={change} projectId={projectId} />
                  : parameter.type === 'string' && parameter.multiline === false ? <TextField.Root className="vh-field"><TextField.Input aria-label={parameter.label} id={id} type="text" value={String(value)} onChange={e => change(e.target.value)} maxLength={parameter.maxLength ?? 16000} /></TextField.Root>
                  : parameter.type === 'string' ? <TextField.Root className="vh-field"><TextField.Textarea aria-label={parameter.label} autoresize={false} id={id} value={String(value)} onChange={e => change(e.target.value)} maxLength={parameter.maxLength ?? 16000} className="resize-y" /></TextField.Root>
                  : parameter.type === 'number' ? <TextField.Root className="vh-field"><TextField.Input aria-label={parameter.label} id={id} type="number" value={String(value)} min={parameter.min} max={parameter.max} step={parameter.integer ? 1 : 'any'} onChange={e => change(e.target.value === '' ? '' : Number(e.target.value))} /></TextField.Root>
                  : parameter.type === 'boolean' ? <input id={id} type="checkbox" checked={Boolean(value)} onChange={e => change(e.target.checked)} />
                  : <select id={id} value={String(value)} onChange={e => change(e.target.value)} className={fieldClass}><option value="" disabled>{uiMessages["ui.app.select"]()}</option>{parameter.options.map(option => <option key={option} value={option}>{option}</option>)}</select>}
                {parameter.description && <p className="text-[11px] text-[var(--vh-text-2)]">{parameter.description}</p>}
              </div>;
            })}
            </div>
  );
}
