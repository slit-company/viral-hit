import { z } from 'zod';
import type { WorkspaceModelOption } from '../effects/workspace-models';
import { validateReferenceCounts, type ReferenceInputs } from '../generation-providers/reference-inputs';
import { appendStudioSource, restoreStudioSources, studioMediaSourceSchema, studioSourceCounts, type StudioMediaSource } from './studio-media-sources';
import type { ProjectGenerationItem } from '../effects/project-generations';

export const visualSourcesSchema = z.object({ sources: z.array(studioMediaSourceSchema).max(20) }).strict();
export function visualReferenceInputs(model?: WorkspaceModelOption | null): ReferenceInputs {
  return model?.referenceInputs ?? { image: { min: model?.requiresImageInput ? 1 : 0, max: model?.mediaSchema?.image.max ?? 0 }, video: { min: 0, max: model?.mediaSchema?.video.max ?? 0 }, audio: { min: 0, max: model?.mediaSchema?.audio.max ?? 0 } };
}
export function appendVisualSource(draft: z.infer<typeof visualSourcesSchema>, source: StudioMediaSource, model: WorkspaceModelOption) {
  return appendStudioSource(draft, source, visualReferenceInputs(model));
}
export function visualSourceReferences(sources: StudioMediaSource[], model?: WorkspaceModelOption | null) {
  if (!model || model.available === false) throw Error('Choose an available model first.');
  validateReferenceCounts(studioSourceCounts(sources), visualReferenceInputs(model), model.name);
  return sources.map(source => ({ assetId: source.id, role: source.type === 'audio' ? 'audio_track' as const : 'reference' as const }));
}
export function restoreVisualSources(projectId: string, item: Pick<ProjectGenerationItem, 'referenceImages' | 'referenceVideos' | 'referenceAudios'>, library: StudioMediaSource[]) {
  return visualSourcesSchema.parse({ sources: restoreStudioSources(projectId, item, library) });
}
