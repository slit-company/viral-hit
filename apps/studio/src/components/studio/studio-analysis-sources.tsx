import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Action } from '@/components/base/action';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { resolveAnalysisInputs, ANALYSIS_MEDIA_KINDS } from '@/core/generation-providers/analysis-inputs';
import { analysisSourceCounts } from '@/core/studio/studio-analysis';
import { loadStudioAnalysisSources, type StudioAnalysisController } from './use-studio-analysis';

export function StudioAnalysisSources({ projectId, analysis, disabled }: { projectId: string; analysis: StudioAnalysisController; disabled: boolean }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const library = useQuery({ queryKey: ['studio-analysis-sources', projectId], queryFn: () => loadStudioAnalysisSources(projectId), enabled: open && !disabled, staleTime: 0 });
  const selected = new Set(analysis.draft.sources.map(source => source.id));
  const limits = resolveAnalysisInputs(analysis.model?.analysisInputs);
  const counts = analysisSourceCounts(analysis.draft.sources);
  const candidates = (library.data?.sources ?? []).filter(source => limits[source.type].max > 0 && !selected.has(source.id) && `${source.filename} ${source.id}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <Action className="vh-secondary shrink-0" aria-label="Analysis sources" disabled={disabled} onClick={() => setOpen(true)}>Sources · {selected.size}</Action>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-32px)] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto]">
        <DialogTitle>Analysis sources</DialogTitle>
        <DialogDescription className="pr-6">Choose project media to review together. Selections are saved in this browser tab. Analyze starts a separate request.</DialogDescription>
        <div className="space-y-3">
          <p className="text-xs text-[var(--vh-text-2)]">{ANALYSIS_MEDIA_KINDS.map(kind => `${kind}: ${counts[kind]} selected (${limits[kind].min}–${limits[kind].max} allowed)`).join(' · ')}</p>
          <Input aria-label="Find analysis source" placeholder="Find a file by name or ID" value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          {analysis.draft.sources.map(source => <div key={source.id} className="flex items-center gap-3 rounded-lg border border-[var(--vh-border)] p-3 text-sm">
            <span className="min-w-0 flex-1 break-words">{source.filename}<small className="block text-[var(--vh-text-2)]">{source.type} · {source.id.slice(0, 8)}</small></span>
            <Action className="vh-secondary shrink-0" aria-label={`Remove source ${source.filename} (${source.id})`} disabled={disabled} onClick={() => analysis.update({ sources: analysis.draft.sources.filter(item => item.id !== source.id) })}>Remove</Action>
          </div>)}
          <p className="text-xs font-semibold text-[var(--vh-text-2)]">Project library</p>
          {library.isPending && <p role="status">Loading project media…</p>}
          {library.error && <p role="alert">{library.error.message}</p>}
          {candidates.slice(0, 50).map(source => <Action key={source.id} aria-label={`Add source ${source.filename} (${source.id})`} className="flex w-full items-center gap-3 rounded-lg border border-[var(--vh-border)] p-3 text-left text-sm disabled:opacity-50" disabled={disabled || selected.size >= 20 || counts[source.type] >= limits[source.type].max} onClick={() => analysis.add(source)}>
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
