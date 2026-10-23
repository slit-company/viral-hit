import { z } from 'zod';
import type { ReferenceInputs, ReferenceMediaKind } from '../generation-providers/reference-inputs';
import type { ProjectGenerationItem } from '../effects/project-generations';
import { parseLocalProjectAssetUrl } from '../projects/local-project-asset-url';

export const studioMediaSourceSchema = z.object({
  id: z.string().min(1).max(200), type: z.enum(['image', 'video', 'audio']),
  publicUrl: z.string().min(1).max(4096), filename: z.string().max(500),
  /** Specific role chosen for a model that declares referenceRoles. */
  role: z.enum(['style', 'subject', 'pose']).optional(),
}).strict();
export type StudioMediaSource = z.infer<typeof studioMediaSourceSchema>;
export const studioSourceCounts = (sources: Pick<StudioMediaSource, 'type'>[]) => sources.reduce((counts, source) => ({ ...counts, [source.type]: counts[source.type] + 1 }), { image: 0, video: 0, audio: 0 });

export function appendStudioSource<T extends { sources: StudioMediaSource[] }>(draft: T, source: StudioMediaSource, limits: ReferenceInputs): T {
  if (draft.sources.some(item => item.id === source.id)) return draft;
  if (draft.sources.length >= 20 || studioSourceCounts(draft.sources)[source.type] >= limits[source.type].max) throw Error(`This model allows at most ${limits[source.type].max} ${source.type} sources. Remove a source or choose another model.`);
  return { ...draft, sources: [...draft.sources, studioMediaSourceSchema.parse(source)] };
}

/** Recover exact local IDs even outside the library window; never infer ownership from foreign URLs. */
export function restoreStudioSources(projectId: string, item: Pick<ProjectGenerationItem, 'referenceImages' | 'referenceVideos' | 'referenceAudios'>, library: StudioMediaSource[]): StudioMediaSource[] {
  const sources: StudioMediaSource[] = [];
  for (const [type, urls] of [['image', item.referenceImages], ['video', item.referenceVideos], ['audio', item.referenceAudios ?? []]] as [ReferenceMediaKind, string[]][]) {
    for (const publicUrl of urls) {
      const local = parseLocalProjectAssetUrl(publicUrl);
      if (local && local.projectId !== projectId) throw Error('Saved source belongs to another project');
      const found = library.find(source => source.type === type && (local ? source.id === local.assetId : source.publicUrl === publicUrl));
      if (!found && !local) throw Error('A saved source is unavailable in the project library. Import it again before reusing this request.');
      const source = found ?? { id: local!.assetId, type, publicUrl, filename: local!.assetId };
      if (!sources.some(existing => existing.id === source.id)) sources.push(source);
    }
  }
  return sources;
}
