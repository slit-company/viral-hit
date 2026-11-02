import { useState } from 'react';
import { Film, Loader2, Plus } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { NativeSelect } from '@/components/ui/native-select';
import type { TimelineTransitionKind } from '@/core/editor/transition-contract';
import { readyTakes, type ShotSequenceView } from '@/core/shot-harness/sequence';
import { TRANSITION_LABELS } from '@/components/editor/transition-labels';
import { useSendSequence } from './use-cinema';

const JOINS: readonly (TimelineTransitionKind | 'none')[] = ['none', 'crossfade', 'fade-black', 'slide-left', 'wipe-left', 'zoom-in'];

function Sequence({ projectId, sequence }: { projectId: string; sequence: ShotSequenceView }) {
  const [join, setJoin] = useState<TimelineTransitionKind | 'none'>('crossfade');
  const send = useSendSequence(projectId);
  const ready = sequence.positions.filter((slot) => readyTakes(slot).length > 0).length;
  return <article className="space-y-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4">
    <header className="flex flex-wrap items-center gap-2">
      <Film className="size-4" aria-hidden="true" />
      <h3 className="text-sm font-semibold">{m['ui.cinema.sequence_title']({ count: sequence.positions.length })}</h3>
      <label className="ml-auto flex items-center gap-2 whitespace-nowrap text-xs text-[var(--vh-text-2)]">{m['ui.cinema.sequence_transition']()}
        <NativeSelect aria-label={m['ui.cinema.sequence_transition']()} value={join} onChange={(event) => setJoin(event.target.value as TimelineTransitionKind | 'none')} className="h-8 text-xs">
          {JOINS.map((kind) => <option key={kind} value={kind}>{TRANSITION_LABELS[kind]()}</option>)}
        </NativeSelect>
      </label>
      <Action type="button" className="vh-secondary inline-flex items-center gap-1.5" disabled={send.isPending || ready === 0}
        onClick={() => send.mutate({ sequence, transition: join === 'none' ? null : { kind: join, duration: 0.5 } })}>
        {send.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{m['ui.cinema.sequence_add']()}
      </Action>
    </header>
    <ol className="flex gap-2 overflow-x-auto pb-1">
      {sequence.positions.map((slot) => {
        const [first] = readyTakes(slot), still = slot.attempts.find((attempt) => attempt.still?.url)?.still;
        return <li key={slot.position} className="w-36 shrink-0 space-y-1">
          <div className="relative aspect-video overflow-hidden rounded-lg bg-[var(--vh-control)]">
            {first?.take.url ? <video src={first.take.url} muted playsInline preload="metadata" className="size-full object-cover" />
              : still?.url ? <img src={still.url} alt="" className="size-full object-cover opacity-70" />
                : <div className="grid size-full place-items-center"><Loader2 className="size-4 animate-spin text-[var(--vh-text-3)]" /></div>}
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 text-[10px] font-semibold text-white">{slot.position}</span>
          </div>
          <p className="line-clamp-2 text-[11px] leading-4 text-[var(--vh-text-2)]">{slot.attempts[0].spec?.action || slot.attempts[0].spec?.subject || slot.attempts[0].prompt}</p>
        </li>;
      })}
    </ol>
    {send.isSuccess && <p role="status" className="text-xs text-emerald-800">{m['ui.cinema.sequence_added']({ count: send.data })}</p>}
    {send.isError && <p role="alert" className="text-xs text-red-700">{send.error.message}</p>}
  </article>;
}

/** Multi-shot sequences, each cut from its best finished takes. */
export function SequenceStrip({ projectId, sequences }: { projectId: string; sequences: ShotSequenceView[] }) {
  const multi = sequences.filter((sequence) => sequence.positions.length > 1);
  if (!multi.length) return null;
  return <section aria-label={m['ui.cinema.sequences']()} className="space-y-3">
    {multi.map((sequence) => <Sequence key={sequence.sequenceId} projectId={projectId} sequence={sequence} />)}
  </section>;
}

/** Above the form: which sequence the next render joins and how. */
export function SequenceBanner({ position, mode, frameUrl, onReset }: { position: number; mode: 'continue' | 'edit' | 'add'; frameUrl?: string; onReset: () => void }) {
  const message = mode === 'continue' ? m['ui.cinema.banner_continue']({ position: position - 1 })
    : mode === 'edit' ? m['ui.cinema.banner_edit']({ position }) : m['ui.cinema.banner_sequence']({ position });
  return <div role="status" className="flex items-center gap-3 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-2.5">
    {frameUrl ? <img src={frameUrl} alt="" className="h-10 w-16 shrink-0 rounded-md object-cover" /> : <Film className="size-4 shrink-0" aria-hidden="true" />}
    <p className="min-w-0 flex-1 text-xs leading-5">{message}</p>
    <Action type="button" className="vh-secondary !min-h-8 shrink-0 !px-2 !py-1 !text-[11px]" onClick={onReset}>{m['ui.cinema.new_sequence']()}</Action>
  </div>;
}
