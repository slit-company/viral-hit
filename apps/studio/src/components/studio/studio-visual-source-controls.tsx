import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { Action } from '@/components/base/action';
import { StudioMediaSources } from './studio-media-sources';
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
    {source.unreadable && <div role="status" className="flex flex-wrap items-center gap-2 text-xs"><span>Saved source selection is unreadable and retained. New selections are not saved yet.</span><Action className="vh-secondary" disabled={disabled} onClick={source.replaceUnreadable}>Replace saved sources</Action></div>}
    {(accepts || source.sources.length > 0) && <div className="flex flex-wrap items-center gap-2">
      <StudioMediaSources projectId={projectId} sources={source.sources} limits={limits} onAdd={source.add} onRemove={source.remove} label="Visual" disabled={disabled} />
      {accepts && <Action className="vh-secondary flex items-center gap-1.5" aria-label="Upload visual reference files" disabled={disabled || model?.available === false} onClick={() => input.current?.click()}><Upload size={15} />Upload files</Action>}
      <span className="text-xs text-[var(--vh-text-2)]">{REFERENCE_MEDIA_KINDS.filter(kind => limits[kind].max || counts[kind]).map(kind => `${kind}: ${counts[kind]} / ${limits[kind].min}–${limits[kind].max}`).join(' · ')}</span>
    </div>}
    <input ref={input} aria-label="Visual reference files" type="file" className="hidden" multiple accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/aac" onChange={event => { void source.upload(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    {!valid && <p role="status" className="text-xs text-[var(--vh-text-2)]">Selected sources do not match this model. Open Sources to review required counts; existing files are retained.</p>}
  </div>;
}
