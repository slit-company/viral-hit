import { useState } from 'react';
import { Loader2, ScanText } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { apiJsonPost } from '@/lib/api-client';
import { parseLocalProjectAssetUrl } from '@/core/projects/local-project-asset-url';
import { LIGHT_DIRECTIONS, LIGHT_PRESETS, relightPrompt, textEditPrompt, type LightDirection, type LightPreset } from '@/core/studio/image-recipes';

type Block = { text: string; box: { x: number; y: number; width: number; height: number } };
const PRESET: Record<LightPreset, () => string> = {
  'golden-hour': () => m['ui.recipe.light_golden_hour'](), 'blue-hour': () => m['ui.recipe.light_blue_hour'](), 'neon-night': () => m['ui.recipe.light_neon_night'](),
  'studio-softbox': () => m['ui.recipe.light_studio'](), 'rim-light': () => m['ui.recipe.light_rim'](), overcast: () => m['ui.recipe.light_overcast'](),
  candlelight: () => m['ui.recipe.light_candle'](), 'hard-noon': () => m['ui.recipe.light_noon'](),
};
const DIRECTION: Record<LightDirection, () => string> = { left: () => m['ui.recipe.from_left'](), right: () => m['ui.recipe.from_right'](), front: () => m['ui.recipe.from_front'](), behind: () => m['ui.recipe.from_behind'](), above: () => m['ui.recipe.from_above']() };

/** Fills the instruction for relighting or replacing text; the person can still edit it before generating. */
export function ImageEditRecipe({ tool, projectId, imageUrl, disabled, onPrompt }: { tool: 'relight' | 'text-edit'; projectId: string; imageUrl: string | null; disabled: boolean; onPrompt: (prompt: string) => void }) {
  const [preset, setPreset] = useState<LightPreset>('golden-hour'), [direction, setDirection] = useState<LightDirection>('left');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [blocks, setBlocks] = useState<Block[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const field = 'grid min-w-0 gap-1.5 text-xs', title = 'font-semibold', card = 'space-y-3 rounded-2xl border border-[var(--vh-border)] p-4', write = 'vh-secondary h-9 w-full px-3 text-xs font-semibold';
  if (tool === 'relight') return <div className={card}><div className="grid grid-cols-2 gap-2">
    <label className={field}><span className={title}>{m['ui.recipe.light']()}</span>
      <NativeSelect aria-label={m['ui.recipe.light']()} disabled={disabled} value={preset} onChange={event => setPreset(event.target.value as LightPreset)}>{LIGHT_PRESETS.map(item => <option key={item} value={item}>{PRESET[item]()}</option>)}</NativeSelect></label>
    <label className={field}><span className={title}>{m['ui.recipe.direction']()}</span>
      <NativeSelect aria-label={m['ui.recipe.direction']()} disabled={disabled} value={direction} onChange={event => setDirection(event.target.value as LightDirection)}>{LIGHT_DIRECTIONS.map(item => <option key={item} value={item}>{DIRECTION[item]()}</option>)}</NativeSelect></label>
  </div>
    <Action type="button" className={write} disabled={disabled} onClick={() => onPrompt(relightPrompt(preset, direction))}>{m['ui.recipe.use']()}</Action>
  </div>;
  const assetId = parseLocalProjectAssetUrl(imageUrl)?.assetId ?? null;
  const find = async () => {
    if (!assetId) { setError(m['ui.recipe.choose_image']()); return; }
    setBusy(true); setError('');
    try { const result = await apiJsonPost<{ blocks: Block[] }>('/api/app/projects/' + encodeURIComponent(projectId) + '/image-text', { assetId }); setBlocks(result.blocks); if (!result.blocks.length) setError(m['ui.recipe.no_text']()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : m['ui.recipe.no_text']()); }
    finally { setBusy(false); }
  };
  return <div className={card}>
    <Action type="button" className="vh-secondary inline-flex h-9 items-center gap-2 px-3 text-xs" disabled={disabled || busy} onClick={() => void find()}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ScanText className="size-3.5" />}{busy ? m['ui.recipe.finding']() : m['ui.recipe.find_text']()}
    </Action>
    {blocks && blocks.length > 0 && <div className="flex flex-wrap gap-1.5">{blocks.slice(0, 12).map(block => <button key={block.text + block.box.x + block.box.y} type="button" disabled={disabled}
      className="rounded-full border border-[var(--vh-border)] px-2.5 py-1 text-xs hover:bg-[var(--vh-control)]" onClick={() => { setFrom(block.text); if (!to) setTo(block.text); }}>{block.text}</button>)}</div>}
    {error && <p className="text-xs text-[var(--vh-text-2)]">{error}</p>}
    <div className="grid grid-cols-2 gap-2">
      <label className={field}><span className={title}>{m['ui.recipe.from']()}</span><Input aria-label={m['ui.recipe.from']()} disabled={disabled} value={from} maxLength={300} onChange={event => setFrom(event.target.value)} /></label>
      <label className={field}><span className={title}>{m['ui.recipe.to']()}</span><Input aria-label={m['ui.recipe.to']()} disabled={disabled} value={to} maxLength={300} onChange={event => setTo(event.target.value)} /></label>
    </div>
    <Action type="button" className={write} disabled={disabled || !from.trim() || !to.trim()} onClick={() => onPrompt(textEditPrompt(from, to))}>{m['ui.recipe.use']()}</Action>
  </div>;
}
