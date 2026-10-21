import { useState } from 'react';
import { Files, Image, Music, Video } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { ANALYSIS_MEDIA_KINDS, type AnalysisInputs } from '@/core/generation-providers/analysis-inputs';
import { canAttachAnalysisReference } from '@/core/creative-canvas/analysis-references';
import type { CanvasCard, CanvasDraftCard } from '@/core/creative-canvas/canvas-types';

const icons = { image: Image, video: Video, audio: Music };

/** Selects existing Canvas assets; the ordinary Media panel owns import and placement. */
export function AnalysisSources({ draft, cards, inputs, disabled, onAttach, onDetach }: {
  draft: CanvasDraftCard; cards: Record<string, CanvasCard>; inputs: AnalysisInputs; disabled: boolean;
  onAttach: (draftId: string, cardId: string) => void;
  onDetach: (draftId: string, cardId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const attached = new Set(draft.referenceCardIds);
  return <>
    <Action aria-label="Analysis sources" title="Analysis sources" disabled={disabled} onClick={() => setOpen(true)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)] px-2 text-xs"><Files size={16} /><span>Sources · {attached.size}</span></Action>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-32px)] grid-rows-[auto_auto_minmax(0,1fr)_auto]">
        <DialogTitle>Analysis sources</DialogTitle>
        <DialogDescription className="pr-6">Select the media to review together. Add files to this Canvas from Media first. Changes are saved to this draft; analysis starts only when you choose Analyze.</DialogDescription>
        <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
          {ANALYSIS_MEDIA_KINDS.map(kind => {
            const candidates = Object.values(cards).filter(card => card.type === kind && card.id !== draft.id && (card.url || attached.has(card.id)));
            const selected = candidates.filter(card => attached.has(card.id)).length;
            if (!inputs[kind].max && !selected) return null;
            const Icon = icons[kind];
            return <section key={kind} aria-label={`${kind} sources`} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon size={16} /><span className="capitalize">{kind}</span><span className="ml-auto text-xs font-normal text-[var(--vh-text-2)]">{selected} selected · {inputs[kind].min}–{inputs[kind].max} allowed</span></h3>
              {!candidates.length && <p className="text-sm text-[var(--vh-text-2)]">No {kind} sources on this Canvas.</p>}
              {candidates.map(card => {
                const checked = attached.has(card.id);
                const canAdd = canAttachAnalysisReference(draft, card, cards, inputs);
                return <Action key={card.id} aria-label={`${checked ? 'Remove' : 'Add'} ${card.name}`} aria-pressed={checked} disabled={disabled || (!checked && !canAdd)} onClick={() => (checked ? onDetach : onAttach)(draft.id, card.id)} className="flex w-full items-center gap-3 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-surface)] p-3 text-left text-sm disabled:opacity-50">
                  <Icon className="shrink-0 text-[var(--vh-text-2)]" size={20} /><span className="min-w-0 flex-1 break-words">{card.name}</span><span className="shrink-0 text-xs font-semibold text-[var(--vh-accent)]">{checked ? 'Selected' : 'Add'}</span>
                </Action>;
              })}
            </section>;
          })}
        </div>
        <DialogFooter><Action className="vh-primary" onClick={() => setOpen(false)}>Done</Action></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
