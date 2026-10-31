import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Action } from '@/components/base/action';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { REFERENCE_MEDIA_KINDS, type ReferenceInputs } from '@/core/generation-providers/reference-inputs';
import { studioSourceCounts, type StudioMediaSource } from '@/core/studio/studio-media-sources';
import { loadStudioSources } from './use-studio-source-actions';

export function StudioMediaSources({ projectId, sources, limits, onAdd, onRemove, label, disabled, roles, onRole }: { projectId: string; sources: StudioMediaSource[]; limits: ReferenceInputs; onAdd: (source: StudioMediaSource) => void; onRemove: (id: string) => void; label: string; disabled: boolean;
  /** Specific roles the selected model declares; each visual source can take one. */
  roles?: readonly ('style' | 'subject' | 'pose')[]; onRole?: (id: string, role: StudioMediaSource['role']) => void }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const library = useQuery({ queryKey: ['studio-media-sources', projectId], queryFn: () => loadStudioSources(projectId), enabled: open && !disabled, staleTime: 0 });
  const selected = new Set(sources.map(source => source.id));
  const counts = studioSourceCounts(sources);
  const candidates = (library.data?.sources ?? []).filter(source => limits[source.type].max > 0 && !selected.has(source.id) && `${source.filename} ${source.id}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <Action className="vh-secondary shrink-0" aria-label={uiMessages["studio.controls.sources_label"]({ label })} disabled={disabled} onClick={() => setOpen(true)}>{uiMessages["studio.media.sources_cdc0"]()}{" "}{selected.size}</Action>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-32px)] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto]">
        <DialogTitle>{label} {uiMessages["studio.media.sources_bce1"]()}</DialogTitle>
        <DialogDescription className="pr-6">{uiMessages["studio.media.choose_project_media_for_this_model_selections_are_saved_in_this_browser_tab_generation_starts_a_sep_a5e6"]()}</DialogDescription>
        <div className="space-y-3">
          <p className="text-xs text-[var(--vh-text-2)]">{REFERENCE_MEDIA_KINDS.map(kind => uiMessages["studio.controls.source_count"]({ kind: kind === "audio" ? uiMessages["studio.media.audio_acda"]() : kind === "image" ? uiMessages["studio.tools.image"]() : uiMessages["studio.tools.video"](), count: counts[kind], min: limits[kind].min, max: limits[kind].max })).join(' · ')}</p>
          <Input aria-label={uiMessages["studio.controls.find_source"]({ label: label.toLowerCase() })} placeholder={uiMessages["studio.media.find_a_file_by_name_or_id_bbc3"]()} value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          {sources.map(source => <div key={source.id} className="flex items-center gap-3 rounded-lg border border-[var(--vh-border)] p-3 text-sm">
            <span className="min-w-0 flex-1 break-words">{source.filename}<small className="block text-[var(--vh-text-2)]">{source.type} · {source.id.slice(0, 8)}</small></span>
            {roles?.length && onRole && source.type !== 'audio' ? <NativeSelect aria-label={`Role of ${source.filename}`} disabled={disabled} value={source.role && roles.includes(source.role) ? source.role : ''} onChange={event => onRole(source.id, (event.target.value || undefined) as StudioMediaSource['role'])} className="h-9 w-auto shrink-0">
              <option value="">{uiMessages["studio.media.reference_db1c"]()}</option>{roles.map(role => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}
            </NativeSelect> : null}
            <Action className="vh-secondary shrink-0" aria-label={`Remove source ${source.filename} (${source.id})`} disabled={disabled} onClick={() => onRemove(source.id)}>{uiMessages["ui.app.remove_2"]()}</Action>
          </div>)}
          <p className="text-xs font-semibold text-[var(--vh-text-2)]">{uiMessages["studio.media.project_library_77db"]()}</p>
          {library.isPending && <p role="status">{uiMessages["studio.media.loading_project_media_a8a4"]()}</p>}
          {library.error && <p role="alert">{library.error.message}</p>}
          {candidates.slice(0, 50).map(source => <Action key={source.id} aria-label={`Add source ${source.filename} (${source.id})`} className="flex w-full items-center gap-3 rounded-lg border border-[var(--vh-border)] p-3 text-left text-sm disabled:opacity-50" disabled={disabled || selected.size >= 20 || counts[source.type] >= limits[source.type].max} onClick={() => onAdd(source)}>
            <span className="min-w-0 flex-1 break-words">{source.filename}<small className="block text-[var(--vh-text-2)]">{source.type} · {source.id.slice(0, 8)}</small></span><span className="shrink-0">{uiMessages["ui.characters.add"]()}</span>
          </Action>)}
          {!library.isPending && !library.error && !candidates.length && <p className="text-sm text-[var(--vh-text-2)]">{uiMessages["studio.media.no_matching_unselected_files_use_upload_files_to_add_media_ecdc"]()}</p>}
          {(candidates.length > 50 || library.data?.limited) && <p className="text-xs text-[var(--vh-text-2)]">{uiMessages["studio.media.showing_up_to_50_matches_from_the_latest_500_membership_entries_refine_the_search_older_selected_sou_0bb9"]()}</p>}
        </div>
        <DialogFooter><Action className="vh-secondary" disabled={disabled || library.isFetching} onClick={() => void library.refetch()}>{uiMessages["studio.media.refresh_files_75bf"]()}</Action><Action className="vh-primary" onClick={() => setOpen(false)}>{uiMessages["ui.skills.done"]()}</Action></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
