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
      <div className="pr-8"><p className="mb-2 text-[10px] font-semibold tracking-[0.2em] text-[var(--color-lime-text)]">VIRAL HIT / RECOVERY</p><DialogTitle>Local timeline drafts</DialogTitle><DialogDescription className="mt-2">Recover editing changes that were not confirmed saved.</DialogDescription></div>
      <div className="min-h-0 space-y-4 overflow-y-auto" aria-label="Draft review">
        <p className="text-xs leading-relaxed text-[var(--vh-text-2)]">Drafts stay in this browser and may come from another open tab. Restoring combines a draft with the latest saved timeline. Conflicting edits are kept for review and never overwrite the saved timeline automatically.</p>
        {selected ? <>
          <label className="block space-y-2 text-xs"><span>Choose a draft</span><select aria-label="Choose a draft" value={selected.draft.id} disabled={busy} onChange={event => setSelectedId(event.target.value)} className="h-11 w-full min-w-0 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-3">{records.map(record => <option key={record.draft.id} value={record.draft.id}>{new Date(record.draft.updatedAt).toLocaleString()} · {record.draft.id.slice(0, 8)}</option>)}</select></label>
          <section className="space-y-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-4 text-xs"><p className="break-words font-semibold">{selected.draft.document.name}</p><p>{selected.draft.document.tracks.flatMap(track => track.clips).length} clips · {selected.draft.document.duration.toFixed(1)} seconds</p><p className="text-[var(--vh-text-2)]">Based on saved revision {selected.draft.baseVersion}. Media files are referenced, not included.</p></section>
          <div className="flex flex-wrap gap-4 text-xs"><Action disabled={busy} onClick={() => download(selected)} className="underline">Download draft JSON</Action><Action disabled={busy} onClick={() => onDiscard(selected)} className="text-[var(--vh-text-2)] underline">Delete this draft</Action></div>
        </> : <p className="rounded-xl bg-[var(--vh-control)] p-4 text-sm">No recoverable drafts in this browser.</p>}
        {error && <p ref={errorPanel} role="alert" className="break-words rounded-lg bg-red-500/10 p-3 text-xs leading-relaxed text-red-800">{error}</p>}
        <Action disabled={busy} onClick={() => onReload()} className="text-xs text-[var(--vh-text-2)] underline">Reload draft list</Action>
      </div>
      <div className="flex gap-3 border-t border-[var(--vh-border)] pt-4"><Action disabled={busy} onClick={onClose} className="vh-secondary flex-1 text-xs">Continue editing</Action><Action disabled={busy || !selected || !canRestore} onClick={() => selected && void onRestore(selected)} className="vh-primary flex-1 text-xs">{busy ? 'Restoring…' : 'Restore draft'}</Action></div>
    </DialogContent>
  </Dialog>;
}
