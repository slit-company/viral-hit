import { m as uiMessages } from '@/paraglide/messages.js';
import { useEffect, useRef, useState } from 'react';
import { Action } from '@/components/base/action';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { DraftRecord } from '@/core/editor/timeline-drafts';

type Props = { canRestore: boolean; open: boolean; records: DraftRecord[]; error: string; busy: boolean; onClose: () => void; onRestore: (record: DraftRecord) => Promise<void>; onDiscard: (record: DraftRecord) => void; onReload: () => unknown };
export function TimelineDraftRecovery({ canRestore, open, records, error, busy, onClose, onRestore, onDiscard, onReload }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const errorPanel = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorPanel.current?.scrollIntoView({ block: 'center' }); }, [error]);
  const selected = records.find(record => record.draft.id === selectedId) ?? records[0];
  function download(record: DraftRecord) {
    const url = URL.createObjectURL(new Blob([record.serialized], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `viral-hit-timeline-draft-${record.draft.id}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border-[var(--vh-border)] bg-[var(--vh-surface)] text-[var(--vh-text-1)] sm:max-w-xl">
      <div className="pr-8"><p className="mb-2 text-[10px] font-semibold tracking-[0.2em] text-[var(--color-lime-text)]">{uiMessages["ui.editor.viral_hit_recovery"]()}</p><DialogTitle>{uiMessages["ui.editor.local_timeline_drafts"]()}</DialogTitle><DialogDescription className="mt-2">{uiMessages["ui.editor.recover_editing_changes_that_were_not_confirmed_saved"]()}</DialogDescription></div>
      <div className="min-h-0 space-y-4 overflow-y-auto" aria-label={uiMessages["ui.editor.draft_review"]()}>
        <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">{uiMessages["ui.editor.drafts_stay_in_this_browser_and_may_come_from_another_open_tab_restoring_co"]()}</p>
        {selected ? <>
          <label className="block space-y-2 text-xs"><span>{uiMessages["ui.editor.choose_a_draft"]()}</span><select aria-label={uiMessages["ui.editor.choose_a_draft"]()} value={selected.draft.id} disabled={busy} onChange={event => setSelectedId(event.target.value)} className="h-11 w-full min-w-0 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-3">{records.map(record => <option key={record.draft.id} value={record.draft.id}>{new Date(record.draft.updatedAt).toLocaleString()} · {record.draft.id.slice(0, 8)}</option>)}</select></label>
          <section className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-4 text-xs"><p className="break-words font-semibold">{selected.draft.document.name}</p><p>{selected.draft.document.tracks.flatMap(track => track.clips).length} {uiMessages["ui.editor.clips"]()} {selected.draft.document.duration.toFixed(1)} {uiMessages["ui.editor.seconds"]()}</p><p className="text-[var(--vh-text-2)]">{uiMessages["ui.editor.based_on_saved_revision"]()} {selected.draft.baseVersion}{uiMessages["ui.editor.media_files_are_referenced_not_included"]()}</p></section>
          <div className="flex flex-wrap gap-4 text-xs"><Action disabled={busy} onClick={() => download(selected)} className="underline">{uiMessages["ui.editor.download_draft_json"]()}</Action><Action disabled={busy} onClick={() => onDiscard(selected)} className="text-[var(--vh-text-2)] underline">{uiMessages["ui.editor.delete_this_draft"]()}</Action></div>
        </> : <p className="rounded-xl bg-[var(--vh-control)] p-4 text-sm">{uiMessages["ui.editor.no_recoverable_drafts_in_this_browser"]()}</p>}
        {error && <p ref={errorPanel} role="alert" className="break-words rounded-lg bg-red-500/10 p-3 text-xs leading-relaxed text-red-800">{error}</p>}
        <Action disabled={busy} onClick={() => onReload()} className="text-xs text-[var(--vh-text-2)] underline">{uiMessages["ui.editor.reload_draft_list"]()}</Action>
      </div>
      <div className="flex gap-3 border-t border-[var(--vh-border)] pt-4"><Action disabled={busy} onClick={onClose} className="vh-secondary flex-1 text-xs">{uiMessages["ui.editor.continue_editing"]()}</Action><Action disabled={busy || !selected || !canRestore} onClick={() => selected && void onRestore(selected)} className="vh-primary flex-1 text-xs">{busy ? uiMessages["ui.common.restoring"]() : uiMessages["ui.editor.restore_draft"]()}</Action></div>
    </DialogContent>
  </Dialog>;
}
