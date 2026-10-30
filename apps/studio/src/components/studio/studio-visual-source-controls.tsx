import { m as uiMessages } from '@/paraglide/messages.js';
import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { Action } from '@/components/base/action';
import { StudioMediaSources } from './studio-media-sources';
import { StudioMaskEditor } from './studio-mask-editor';
import { visualReferenceInputs } from '@/core/studio/studio-visual-sources';
import { REFERENCE_MEDIA_KINDS } from '@/core/generation-providers/reference-inputs';
import { studioSourceCounts } from '@/core/studio/studio-media-sources';
import type { WorkspaceModelOption } from '@/core/effects/workspace-models';
import type { StudioVisualSourcesController } from './use-studio-visual-sources';

export function StudioVisualSourceControls({ projectId, model, source, disabled }: { projectId: string; model: WorkspaceModelOption | null; source: StudioVisualSourcesController; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null), limits = visualReferenceInputs(model), counts = studioSourceCounts(source.sources);
  const accepts = REFERENCE_MEDIA_KINDS.some(kind => limits[kind].max > 0);
  const valid = REFERENCE_MEDIA_KINDS.every(kind => counts[kind] >= limits[kind].min && counts[kind] <= limits[kind].max);
  return <div className="space-y-2">
    {source.unreadable && <div role="status" className="flex flex-wrap items-center gap-2 text-xs"><span>{uiMessages["studio.media.saved_source_selection_is_unreadable_and_retained_new_selections_are_not_saved_yet_8f78"]()}</span><Action className="vh-secondary" disabled={disabled} onClick={source.replaceUnreadable}>{uiMessages["studio.media.replace_saved_sources_ec0d"]()}</Action></div>}
    {(accepts || source.sources.length > 0) && <div className="flex flex-wrap items-center gap-2">
      <StudioMediaSources projectId={projectId} sources={source.sources} limits={limits} onAdd={source.add} onRemove={source.remove} label={uiMessages["studio.media.visual_770d"]()} disabled={disabled} roles={model?.referenceRoles} onRole={source.setRole} />
      {accepts && <Action className="vh-secondary flex items-center gap-1.5" aria-label={uiMessages["studio.media.upload_visual_reference_files_5527"]()} disabled={disabled || model?.available === false} onClick={() => input.current?.click()}><Upload size={15} />{uiMessages["studio.media.upload_files_41ac"]()}</Action>}
      <StudioMaskEditor projectId={projectId} model={model} source={source} disabled={disabled || model?.available === false} />
      <span className="text-xs text-[var(--vh-text-2)]">{REFERENCE_MEDIA_KINDS.filter(kind => limits[kind].max || counts[kind]).map(kind => `${kind === "image" ? uiMessages["studio.tools.image"]() : kind === "video" ? uiMessages["studio.tools.video"]() : uiMessages["studio.media.audio_acda"]()}: ${counts[kind]} / ${limits[kind].min}–${limits[kind].max}`).join(' · ')}</span>
    </div>}
    <input ref={input} aria-label={uiMessages["studio.media.visual_reference_files_10c5"]()} type="file" className="hidden" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/aac" onChange={event => { void source.upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    {!valid && <p role="status" className="text-xs text-[var(--vh-text-2)]">{uiMessages["studio.media.selected_sources_do_not_match_this_model_open_sources_to_review_required_counts_existing_files_are_r_33cc"]()}</p>}
  </div>;
}
