import { TextField } from '@seed-design/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import type { BoardAsset } from './use-storyboards';

export function Field({ label, value, onChange, multiline = false, maxLength = 4000, numeric = false, min = 0, max = 3600 }: {
  label: string; value: string | number; onChange: (value: string) => void; multiline?: boolean; maxLength?: number; numeric?: boolean; min?: number; max?: number;
}) {
  const id = useId();
  return <div className="min-w-0"><label htmlFor={id} className="mb-2 block text-xs font-medium text-[var(--vh-text-2)]">{label}</label><TextField.Root className="vh-field">
    {multiline ? <TextField.Textarea id={id} aria-label={label} autoresize={false} value={String(value)} maxLength={maxLength} onChange={e => onChange(e.target.value)} />
      : <TextField.Input id={id} aria-label={label} type={numeric ? 'number' : 'text'} min={min} max={max} step={numeric ? 'any' : undefined} value={String(value)} maxLength={maxLength} onChange={e => onChange(e.target.value)} />}
  </TextField.Root></div>;
}
export function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="block min-w-0 space-y-2 text-xs font-medium text-[var(--vh-text-2)]">{label}<NativeSelect aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{children}</NativeSelect></label>;
}
export function MediaPreview({ asset, startTime = 0, duration }: { asset?: BoardAsset; startTime?: number; duration?: number }) {
  const media = useRef<HTMLMediaElement | null>(null);
  const seek = () => { if (media.current && media.current.readyState >= 1) media.current.currentTime = Math.min(startTime, media.current.duration); };
  useEffect(seek, [asset?.id, startTime]);
  const playSelection = () => {
    const player = media.current;
    if (player && duration !== undefined && (player.currentTime < startTime || player.currentTime >= startTime + duration)) seek();
  };
  const endSelection = () => {
    const player = media.current;
    if (player && duration !== undefined && player.currentTime >= startTime + duration) player.pause();
  };
  if (!asset) return <p className="text-sm text-[var(--vh-text-2)]">Select project media to inspect it.</p>;
  const url = asset.publicUrl;
  return <figure className="min-w-0 space-y-2">
    {asset.type === 'image' ? <img src={url} alt={asset.filename || asset.id} className="max-h-60 w-full rounded-xl bg-[var(--vh-control)] object-contain" />
      : asset.type === 'video' ? <video ref={node => { media.current = node; }} key={asset.id} src={url} onLoadedMetadata={seek} onPlay={playSelection} onTimeUpdate={endSelection} controls playsInline preload="metadata" className="max-h-60 w-full rounded-xl bg-[var(--vh-control)]" />
      : <audio ref={node => { media.current = node; }} key={asset.id} src={url} onLoadedMetadata={seek} onPlay={playSelection} onTimeUpdate={endSelection} controls preload="metadata" className="w-full" />}
    <figcaption className="break-all text-xs leading-5 text-[var(--vh-text-2)]">{asset.filename || asset.type} · {asset.id}</figcaption>
    {duration !== undefined && <p className="text-xs text-[var(--vh-text-2)]">Selected range: {startTime}–{Number((startTime + duration).toFixed(2))} seconds</p>}
  </figure>;
}
export const panel = 'scroll-mt-28 min-w-0 space-y-5 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5';
export const seconds = (value: string, minimum = 0) => Math.min(3600, Math.max(minimum, Number(value) || minimum));
