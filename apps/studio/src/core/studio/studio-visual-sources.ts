import { z } from 'zod';
import type { WorkspaceModelOption } from '../effects/workspace-models';
import { validateReferenceCounts, type ReferenceInputs } from '../generation-providers/reference-inputs';
import { appendStudioSource, restoreStudioSources, studioMediaSourceSchema, studioSourceCounts, type StudioMediaSource } from './studio-media-sources';
import type { ProjectGenerationItem } from '../effects/project-generations';
import { parseLocalProjectAssetUrl } from '../projects/local-project-asset-url';

/** A painted mask saved as its own project image, tied to the selected image it edits. */
export const studioMaskSchema = z.object({ id: z.string().min(1).max(200), publicUrl: z.string().min(1).max(4096), targetId: z.string().min(1).max(200) }).strict();
export type StudioMask = z.infer<typeof studioMaskSchema>;
export const visualSourcesSchema = z.object({ sources: z.array(studioMediaSourceSchema).max(20), mask: studioMaskSchema.optional() }).strict();
/** The mask applies only while its target image is still selected. */
export const activeStudioMask = (sources: StudioMediaSource[], mask?: StudioMask) =>
  mask && sources.some(source => source.id === mask.targetId && source.type === 'image') ? mask : undefined;
export function visualReferenceInputs(model?: WorkspaceModelOption | null): ReferenceInputs {
  return model?.referenceInputs ?? { image: { min: model?.requiresImageInput ? 1 : 0, max: model?.mediaSchema?.image.max ?? 0 }, video: { min: 0, max: model?.mediaSchema?.video.max ?? 0 }, audio: { min: 0, max: model?.mediaSchema?.audio.max ?? 0 } };
}
export function appendVisualSource(draft: z.infer<typeof visualSourcesSchema>, source: StudioMediaSource, model: WorkspaceModelOption) {
  return appendStudioSource(draft, source, visualReferenceInputs(model));
}
export function visualSourceReferences(sources: StudioMediaSource[], model?: WorkspaceModelOption | null, mask?: StudioMask) {
  if (!model || model.available === false) throw Error('Choose an available model first.');
  validateReferenceCounts(studioSourceCounts(sources), visualReferenceInputs(model), model.name);
  const references: Array<{ assetId: string; role: 'audio_track' | 'reference' | 'source' | 'mask' | 'style' | 'subject' | 'pose' }> = sources.map(source => ({ assetId: source.id,
    role: source.type === 'audio' ? 'audio_track' as const : source.role && model.referenceRoles?.includes(source.role) ? source.role : 'reference' as const }));
  if (!model.maskInput) return references;
  const active = activeStudioMask(sources, mask);
  if (model.maskInput.required && !active) throw Error('Mark the area to change first.');
  if (!active) return references;
  return [...references.map(reference => reference.assetId === active.targetId && reference.role === 'reference' ? { ...reference, role: 'source' as const } : reference), { assetId: active.id, role: 'mask' as const }];
}
export function restoreVisualSources(projectId: string, item: Pick<ProjectGenerationItem, 'referenceImages' | 'referenceVideos' | 'referenceAudios' | 'referenceMask' | 'referenceRoles'>, library: StudioMediaSource[]) {
  const roles = new Map((item.referenceRoles ?? []).map(entry => [entry.url, entry.role]));
  const sources = restoreStudioSources(projectId, item, library).map(source => {
    const role = roles.get(source.publicUrl);
    return role === 'style' || role === 'subject' || role === 'pose' ? { ...source, role } : source;
  });
  const local = item.referenceMask ? parseLocalProjectAssetUrl(item.referenceMask) : null;
  if (local && local.projectId !== projectId) throw Error('Saved mask belongs to another project');
  const target = sources.find(source => source.type === 'image');
  return visualSourcesSchema.parse({ sources, ...(local && target ? { mask: { id: local.assetId, publicUrl: item.referenceMask!, targetId: target.id } } : {}) });
}
