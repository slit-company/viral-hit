import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, Trash2, WandSparkles } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { ImageLayer } from '@/core/image-layers/contract';
import { cn } from '@/lib/utils';
import { checker, layerUrl } from './layer-canvas';

export type ProjectImage = { id: string; filename: string | null; publicUrl: string };
type Props = {
  projectId: string; layer: ImageLayer; selected: boolean; first: boolean; last: boolean; images: ProjectImage[];
  onSelect: () => void; onChange: (patch: Partial<ImageLayer>, now?: boolean) => void; onMove: (step: 1 | -1) => void; onRemove: () => void; onEdit: () => void;
};
const percent = (value: number) => Math.round(value * 100);

/** One layer: thumbnail, name, visibility and order; the selected one also shows its opacity, size and actions. */
export function LayerRow({ projectId, layer, selected, first, last, images, onSelect, onChange, onMove, onRemove, onEdit }: Props) {
  const name = layer.name;
  return <li className={cn('rounded-xl border p-2 transition-colors', selected ? 'border-[var(--vh-text-1)] bg-[var(--vh-control)]' : 'border-[var(--vh-border)] hover:bg-[var(--vh-control)]')}>
    <div className="flex items-center gap-2">
      <button type="button" aria-pressed={selected} aria-label={m['ui.layers.select']({ name })} onClick={onSelect} className="size-11 shrink-0 overflow-hidden rounded-md shadow-[0_0_0_1px_var(--vh-border)]" style={checker}>
        <img src={layerUrl(projectId, layer.assetId)} alt="" className={cn('size-full object-contain', !layer.visible && 'opacity-30')} />
      </button>
      <Input aria-label={m['ui.layers.layer_name']()} value={name} maxLength={80} onFocus={onSelect} onChange={event => onChange({ name: event.target.value })} className="h-8 min-w-0 flex-1 text-xs" />
      <Button type="button" variant="ghost" size="icon-sm" aria-label={layer.visible ? m['ui.layers.hide']({ name }) : m['ui.layers.show']({ name })} onClick={() => onChange({ visible: !layer.visible })}>{layer.visible ? <Eye /> : <EyeOff />}</Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={m['ui.layers.up']({ name })} disabled={first} onClick={() => onMove(1)}><ArrowUp /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={m['ui.layers.down']({ name })} disabled={last} onClick={() => onMove(-1)}><ArrowDown /></Button>
    </div>
    {selected && <div className="mt-2 space-y-3 border-t border-[var(--vh-border)] px-1 pb-1 pt-3">
      <label className="block text-xs">
        <span className="flex justify-between font-medium"><span>{m['ui.layers.opacity']()}</span><span className="tabular-nums text-[var(--vh-text-2)]">{percent(layer.opacity)}%</span></span>
        <input type="range" min={0} max={100} step={1} value={percent(layer.opacity)} onChange={event => onChange({ opacity: Number(event.target.value) / 100 })} className="mt-1.5 w-full accent-[var(--vh-text-1)]" aria-label={m['ui.layers.opacity']()} />
      </label>
      <label className="block text-xs">
        <span className="flex justify-between font-medium"><span>{m['ui.layers.size']()}</span><span className="tabular-nums text-[var(--vh-text-2)]">{percent(layer.scale)}%</span></span>
        <input type="range" min={5} max={400} step={1} value={percent(layer.scale)} onChange={event => onChange({ scale: Number(event.target.value) / 100 })} className="mt-1.5 w-full accent-[var(--vh-text-1)]" aria-label={m['ui.layers.size']()} />
      </label>
      <p className="text-[11px] text-[var(--vh-text-3)]">{m['ui.layers.drag_hint']()}</p>
      <div className="flex flex-wrap gap-1.5">
        <Action type="button" className="vh-secondary inline-flex h-8 items-center gap-1.5 px-2.5 text-xs" onClick={onEdit}><WandSparkles className="size-3.5" />{m['ui.layers.edit_ai']()}</Action>
        <Action type="button" className="vh-secondary inline-flex h-8 items-center gap-1.5 px-2.5 text-xs" onClick={() => onChange({ x: 0, y: 0, scale: 1 })}><RotateCcw className="size-3.5" />{m['ui.layers.reset']()}</Action>
        <Action type="button" className="vh-secondary inline-flex h-8 items-center gap-1.5 px-2.5 text-xs" disabled={first && last} onClick={onRemove}><Trash2 className="size-3.5" />{m['ui.layers.remove']()}</Action>
      </div>
      <NativeSelect aria-label={m['ui.layers.replace']()} value="" onChange={event => { if (event.target.value) onChange({ assetId: event.target.value }, true); }}>
        <option value="">{m['ui.layers.replace']()}</option>
        {images.filter(image => image.id !== layer.assetId).map(image => <option key={image.id} value={image.id}>{image.filename || image.id}</option>)}
      </NativeSelect>
    </div>}
  </li>;
}
