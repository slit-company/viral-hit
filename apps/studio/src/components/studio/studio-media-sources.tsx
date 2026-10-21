import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Action } from '@/components/base/action';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { REFERENCE_MEDIA_KINDS, type ReferenceInputs } from '@/core/generation-providers/reference-inputs';
import { studioSourceCounts, type StudioMediaSource } from '@/core/studio/studio-media-sources';
import { loadStudioSources } from './use-studio-source-actions';

export function StudioMediaSources({ projectId, sources, limits, onAdd, onRemove, label, disabled }: { projectId: string; sources: StudioMediaSource[]; limits: ReferenceInputs; onAdd: (source: StudioMediaSource) => void; onRemove: (id: string) => void; label: 'Analysis' | 'Audio' | 'Visual'; disabled: boolean }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const library = useQuery({ queryKey: ['studio-media-sources', projectId], queryFn: () => loadStudioSources(projectId), enabled: open && !disabled, staleTime: 0 });
  const selected = new Set(sources.map(source => source.id));
  const counts = studioSourceCounts(sources);
  const candidates = (library.data?.sources ?? []).filter(source => limits[source.type].max > 0 && !selected.has(source.id) && `${source.filename} ${source.id}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <Action className="vh-secondary shrink-0" aria-label={`${label} sources`} disabled={disabled} onClick={() => setOpen(true)}>Sources · {selected.size}</Action>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-32px)] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto]">
        <DialogTitle>{label} sources</DialogTitle>
        <DialogDescription className="pr-6">Choose project media for this model. Selections are saved in this browser tab. Generation starts a separate request.</DialogDescription>
        <div className="space-y-3">
          <p className="text-xs text-[var(--vh-text-2)]">{REFERENCE_MEDIA_KINDS.map(kind => `${kind}: ${counts[kind]} selected (${limits[kind].min}–${limits[kind].max} allowed)`).join(' · ')}</p>
          <Input aria-label={`Find ${label.toLowerCase()} source`} placeholder="Find a file by name or ID" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          {sources.map(source => <div key={source.id} className="flex items-center gap-3 rounded-lg border border-[var(--vh-border)] p-3 text-sm">
            <span className="min-w-0 flex-1 break-words">{source.filename}<small className="block text-[var(--vh-text-2)]">{source.type} · {source.id.slice(0, 8)}</small></span>
            <Action className="vh-secondary shrink-0" aria-label={`Remove source ${source.filename} (${source.id})`} disabled={disabled} onClick={() => onRemove(source.id)}>Remove</Action>
          </div>)}
          <p className="text-xs font-semibold text-[var(--vh-text-2)]">Project library</p>
          {library.isPending && <p role="status">Loading project media…</p>}
          {library.error && <p role="alert">{library.error.message}</p>}
          {candidates.slice(0, 50).map(source => <Action key={source.id} aria-label={`Add source ${source.filename} (${source.id})`} className="flex w-full items-center gap-3 rounded-lg border border-[var(--vh-border)] p-3 text-left text-sm disabled:opacity-50" disabled={disabled || selected.size >= 20 || counts[source.type] >= limits[source.type].max} onClick={() => onAdd(source)}>
            <span className="min-w-0 flex-1 break-words">{source.filename}<small className="block text-[var(--vh-text-2)]">{source.type} · {source.id.slice(0, 8)}</small></span><span className="shrink-0">Add</span>
          </Action>)}
          {!library.isPending && !library.error && !candidates.length && <p className="text-sm text-[var(--vh-text-2)]">No matching unselected files. Use Upload files to add media.</p>}
          {(candidates.length > 50 || library.data?.limited) && <p className="text-xs text-[var(--vh-text-2)]">Showing up to 50 matches from the latest 500 membership entries. Refine the search; older selected sources stay attached.</p>}
        </div>
        <DialogFooter><Action className="vh-secondary" disabled={disabled || library.isFetching} onClick={() => void library.refetch()}>Refresh files</Action><Action className="vh-primary" onClick={() => setOpen(false)}>Done</Action></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
