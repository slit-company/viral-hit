import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import type { EditorOperation } from '@/core/commands/editor-commands';
import type { TimelineClip, TimelineDocument } from '@/core/editor/timeline-document';
import {
  DEFAULT_TRANSITION_SECONDS,
  MAX_TRANSITION_SECONDS,
  MIN_TRANSITION_SECONDS,
  TIMELINE_TRANSITION_KINDS,
  type TimelineTransitionKind,
} from '@/core/editor/transition-contract';
import { findOutgoingClip } from '@/core/editor/transitions';
import { TRANSITION_LABELS } from './transition-labels';

/** How the selected base-track visual enters; edits go through the shared editor operations. */
export function TransitionInspector({ document, clip, locked, onEdit }: {
  document: TimelineDocument; clip: TimelineClip; locked: boolean; onEdit: (operation: EditorOperation) => void;
}) {
  const track = document.tracks.find((candidate) => candidate.id === clip.trackId);
  if (!track || track.kind !== 'video' || (clip.sourceType !== 'image' && clip.sourceType !== 'video')) return null;
  const visuals = (clips: TimelineClip[]) => clips.filter((item) => item.sourceType === 'image' || item.sourceType === 'video').map((item) => ({ clip: item }));
  const previous = findOutgoingClip(visuals(track.clips), clip)?.clip ?? null;
  const cuts = document.tracks.filter((candidate) => candidate.kind === 'video' && !candidate.locked)
    .reduce((count, candidate) => count + visuals(candidate.clips).filter(({ clip: item }) => findOutgoingClip(visuals(candidate.clips), item)).length, 0);
  const maxSeconds = Math.min(MAX_TRANSITION_SECONDS, clip.duration);
  const current = clip.transition ?? null;
  const seconds = Math.min(current?.duration ?? DEFAULT_TRANSITION_SECONDS, maxSeconds);
  const choose = (kind: TimelineTransitionKind | null) =>
    onEdit({ type: 'set_transition', clipId: clip.id, transition: kind ? { kind, duration: Math.max(MIN_TRANSITION_SECONDS, seconds) } : null });
  return <fieldset disabled={locked || clip.duration < MIN_TRANSITION_SECONDS} className="mt-3 min-w-0 space-y-3 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)] p-3"
    aria-label={m['ui.editor.transition_title']()}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-xs font-semibold">{m['ui.editor.transition_title']()}</span>
      <span className="min-w-0 truncate text-[11px] text-[var(--vh-text-2)]">
        {previous ? m['ui.editor.transition_from_clip']({ name: previous.name }) : m['ui.editor.transition_from_black']()}
      </span>
    </div>
    <div role="radiogroup" aria-label={m['ui.editor.transition_title']()} className="grid grid-cols-3 gap-1.5">
      {([null, ...TIMELINE_TRANSITION_KINDS] as const).map((kind) => {
        const checked = (current?.kind ?? null) === kind;
        return <Action key={kind ?? 'none'} role="radio" aria-checked={checked} onClick={() => choose(kind)}
          className={`vh-secondary !min-h-9 !px-1.5 !py-1 !text-[11px] ${checked ? 'bg-[var(--vh-control)] ring-1 ring-[var(--vh-graph)]' : ''}`}>
          {TRANSITION_LABELS[kind ?? 'none']()}
        </Action>;
      })}
    </div>
    {current ? <label className="block">
      <span className="mb-2 flex items-center justify-between text-[11px] text-[var(--vh-text-2)]">
        <span>{m['ui.editor.transition_duration']()}</span><span className="tabular-nums">{current.duration.toFixed(2)}s</span>
      </span>
      <input type="range" min={MIN_TRANSITION_SECONDS} max={Math.max(MIN_TRANSITION_SECONDS, maxSeconds)} step={0.05} value={current.duration}
        onChange={(event) => onEdit({ type: 'set_transition', clipId: clip.id, transition: { kind: current.kind, duration: Number(event.target.value) } })}
        className="h-1 w-full accent-[var(--vh-graph)]" />
    </label> : null}
    <div className="flex flex-wrap gap-2">
      <Action disabled={!current || cuts === 0} onClick={() => current && onEdit({ type: 'set_transitions_at_cuts', transition: current })}
        className="vh-secondary !min-h-9 !px-2 !py-1 !text-xs">{m['ui.editor.transition_apply_all']({ count: cuts })}</Action>
      <Action onClick={() => onEdit({ type: 'set_transitions_at_cuts', transition: null })} className="vh-secondary !min-h-9 !px-2 !py-1 !text-xs">
        {m['ui.editor.transition_clear_all']()}</Action>
    </div>
    <p className="text-[11px] leading-relaxed text-[var(--vh-text-2)]">{m['ui.editor.transition_hint']()}</p>
  </fieldset>;
}
