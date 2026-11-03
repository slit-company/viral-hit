import type { ReactNode } from 'react';
import { Footprints, ImagePlus, Replace, X } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { SHAPESHIFT_STYLES, type ShapeshiftMode, type ShapeshiftStyle } from '@/core/shapeshift/options';
import { cn } from '@/lib/utils';
import type { ProjectMedia } from './use-shapeshift';

export const STYLE_LABELS: Record<ShapeshiftStyle, () => string> = {
  none: () => m['ui.shapeshift.style_none'](), anime: () => m['ui.shapeshift.style_anime'](), 'animation-3d': () => m['ui.shapeshift.style_animation_3d'](),
  claymation: () => m['ui.shapeshift.style_claymation'](), comic: () => m['ui.shapeshift.style_comic'](), watercolor: () => m['ui.shapeshift.style_watercolor'](),
  'pixel-art': () => m['ui.shapeshift.style_pixel_art'](), 'film-noir': () => m['ui.shapeshift.style_film_noir'](), neon: () => m['ui.shapeshift.style_neon'](),
  'oil-painting': () => m['ui.shapeshift.style_oil_painting'](),
};
export const MODE_LABELS: Record<ShapeshiftMode, () => string> = { 'motion-transfer': () => m['ui.shapeshift.mode_motion'](), 'object-swap': () => m['ui.shapeshift.mode_swap']() };

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="space-y-2.5">
    <h2 className="text-xs font-semibold">{title}</h2>
    {hint && <p className="text-[11px] leading-4 text-[var(--vh-text-3)]">{hint}</p>}
    {children}
  </section>;
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <div role="group" aria-label={label} className="flex gap-1 rounded-full bg-[var(--vh-control)] p-1">
    {options.map(option => <Action key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}
      className={cn('flex-1 justify-center rounded-full px-3 py-1.5 text-center text-xs', option.value === value ? 'bg-[var(--vh-surface)] font-semibold shadow-sm' : 'text-[var(--vh-text-2)]')}>{option.label}</Action>)}
  </div>;
}

/** Motion transfer or object swap, each with what it keeps from the source. */
export function ModeToggle({ value, onChange }: { value: ShapeshiftMode; onChange: (mode: ShapeshiftMode) => void }) {
  const modes = [
    { id: 'motion-transfer' as const, Icon: Footprints, hint: m['ui.shapeshift.mode_motion_hint']() },
    { id: 'object-swap' as const, Icon: Replace, hint: m['ui.shapeshift.mode_swap_hint']() },
  ];
  return <div role="group" aria-label={m['ui.shapeshift.mode']()} className="grid grid-cols-2 gap-2">
    {modes.map(({ id, Icon, hint }) => <Action key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}
      className={cn('rounded-xl border p-3 text-left transition', value === id ? 'border-[var(--vh-text-1)] bg-[var(--vh-control)]' : 'border-[var(--vh-border)] hover:border-[var(--vh-text-3)]')}>
      <Icon className="mb-2 size-4" aria-hidden="true" />
      <span className="block text-xs font-semibold">{MODE_LABELS[id]()}</span>
      <span className="mt-1 block text-[11px] leading-4 text-[var(--vh-text-2)]">{hint}</span>
    </Action>)}
  </div>;
}

export function StylePicker({ value, onChange }: { value: ShapeshiftStyle; onChange: (style: ShapeshiftStyle) => void }) {
  return <div role="group" aria-label={m['ui.shapeshift.style']()} className="flex flex-wrap gap-1.5">
    {SHAPESHIFT_STYLES.map(style => <Action key={style} type="button" aria-pressed={value === style} onClick={() => onChange(style)}
      className={cn('rounded-full border px-3 py-1.5 text-xs transition', value === style ? 'border-[var(--vh-text-1)] bg-[var(--vh-text-1)] font-semibold text-[var(--vh-bg)]' : 'border-[var(--vh-border)] text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]')}>{STYLE_LABELS[style]()}</Action>)}
  </div>;
}

/** The chosen subject pictures in order, the first one leading, with a tile to add more. */
export function PictureStrip({ pictures, selected, onRemove, onAdd }: { pictures: readonly ProjectMedia[]; selected: readonly string[]; onRemove: (id: string) => void; onAdd: () => void }) {
  const byId = new Map(pictures.map(picture => [picture.id, picture]));
  return <ul className="grid grid-cols-5 gap-2">
    {selected.map((id, index) => {
      const picture = byId.get(id);
      return <li key={id} className="relative aspect-square overflow-hidden rounded-lg bg-[var(--vh-control)] shadow-[0_0_0_1px_var(--vh-border)]">
        {picture && <img src={picture.publicUrl} alt={picture.filename ?? ''} className="size-full object-cover" />}
        <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-[var(--vh-text-1)] text-[10px] font-bold text-[var(--vh-bg)]">{index + 1}</span>
        <Action type="button" aria-label={m['ui.shapeshift.remove_picture']()} onClick={() => onRemove(id)} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white"><X className="size-3" /></Action>
      </li>;
    })}
    <li><Action type="button" onClick={onAdd} aria-label={m['ui.shapeshift.add_pictures']()}
      className="grid aspect-square w-full place-items-center rounded-lg border border-dashed border-[var(--vh-border)] text-[var(--vh-text-2)] transition hover:border-[var(--vh-text-3)] hover:text-[var(--vh-text-1)]"><ImagePlus className="size-4" /></Action></li>
  </ul>;
}
