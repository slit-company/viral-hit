import { m } from '@/paraglide/messages.js';
import { NativeSelect } from '@/components/ui/native-select';
import { DUCKING_LEVELS } from '@/core/editor/audio-ducking';
import type { TimelineClip } from '@/core/editor/timeline-document';

const LABELS = [() => m['ui.editor.duck_little'](), () => m['ui.editor.duck_medium'](), () => m['ui.editor.duck_lot']()];

/** Lowers a music or sound clip whenever a voice clip plays; the preview and both exports follow the same curve. */
export function AudioDuckingControl({ clip, onChange }: { clip: TimelineClip; onChange: (ducking: { level: number } | null) => void }) {
  if (clip.audioRole === 'voice') return null;
  const level = clip.ducking?.level;
  const chosen = level === undefined ? 'off' : String(DUCKING_LEVELS.reduce((best, item) => Math.abs(item - level) < Math.abs(best - level) ? item : best));
  return <label className="block">
    <span className="mb-2 block text-[10px] font-[520] text-[var(--vh-text-2)]">{m['ui.editor.duck_under_voice']()}</span>
    <NativeSelect value={chosen} onChange={event => onChange(event.target.value === 'off' ? null : { level: Number(event.target.value) })}>
      <option value="off">{m['ui.editor.duck_off']()}</option>
      {DUCKING_LEVELS.map((value, index) => <option key={value} value={String(value)}>{LABELS[index]()}</option>)}
    </NativeSelect>
    <span className="mt-1.5 block text-[10px] leading-4 text-[var(--vh-text-3)]">{m['ui.editor.duck_hint']()}</span>
  </label>;
}
