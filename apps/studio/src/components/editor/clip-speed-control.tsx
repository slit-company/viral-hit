import { m } from '@/paraglide/messages.js';
import { NativeSelect } from '@/components/ui/native-select';
import { CLIP_SPEEDS } from '@/core/editor/clip-speed';
import type { TimelineClip } from '@/core/editor/timeline-document';

/** Plays a base-track video faster or slower; the clips after it move with its new length. */
export function ClipSpeedControl({ clip, disabled, onChange }: { clip: TimelineClip; disabled?: boolean; onChange: (speed: number) => void }) {
  const speed = clip.speed ?? 1, listed = CLIP_SPEEDS.some(value => value === speed);
  return <label className="mt-3 block">
    <span className="mb-2 block text-[10px] font-[520] text-[var(--vh-text-2)]">{m['ui.editor.clip_speed']()}</span>
    <NativeSelect value={String(speed)} disabled={disabled} onChange={event => onChange(Number(event.target.value))}>
      {!listed && <option value={String(speed)}>{speed}×</option>}
      {CLIP_SPEEDS.map(value => <option key={value} value={String(value)}>{value}×</option>)}
    </NativeSelect>
    {speed !== 1 && <span className="mt-1.5 block text-[10px] leading-4 text-[var(--vh-text-3)]">{m['ui.editor.clip_speed_hint']()}</span>}
  </label>;
}
