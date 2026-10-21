import { z } from 'zod';
import { resolveAnalysisInputs, validateAnalysisReferenceCounts, type AnalysisMediaKind } from '../generation-providers/analysis-inputs';
import { draftModelOptions, modelOptionsDraftSchema } from '../generation-providers/model-controls';
import { VIDEO_ANALYSIS_DEFAULT_OUTPUT_TOKENS, VIDEO_ANALYSIS_MODEL_ID } from '../effects/video-analysis';
import type { WorkspaceModelOption } from '../effects/workspace-models';
import type { ProjectGenerationItem } from '../effects/project-generations';
import { parseLocalProjectAssetUrl } from '../projects/local-project-asset-url';
import type { AssetFirstGenerationRequest } from '../commands/generation-contract';

export const studioAnalysisSourceSchema = z.object({
  id: z.string().min(1).max(200), type: z.enum(['image', 'video', 'audio']),
  publicUrl: z.string().min(1).max(4096), filename: z.string().max(500),
}).strict();
export type StudioAnalysisSource = z.infer<typeof studioAnalysisSourceSchema>;
export const studioAnalysisDraftSchema = z.object({
  version: z.literal(1), modelId: z.string().min(1).max(200), prompt: z.string().max(12_000),
  depth: z.enum(['standard', 'deep']), modelOptions: modelOptionsDraftSchema.optional(),
  sources: z.array(studioAnalysisSourceSchema).max(20),
}).strict();
export type StudioAnalysisDraft = z.infer<typeof studioAnalysisDraftSchema>;
export const newStudioAnalysisDraft = (modelId = VIDEO_ANALYSIS_MODEL_ID, prompt = ''): StudioAnalysisDraft => ({ version: 1, modelId, prompt, depth: 'standard', sources: [] });
export const analysisSourceCounts = (sources: Pick<StudioAnalysisSource, 'type'>[]) => sources.reduce((counts, source) => ({ ...counts, [source.type]: counts[source.type] + 1 }), { image: 0, video: 0, audio: 0 });

export function appendAnalysisSource(draft: StudioAnalysisDraft, source: StudioAnalysisSource, model: WorkspaceModelOption): StudioAnalysisDraft {
  if (draft.sources.some(item => item.id === source.id)) return draft;
  const limits = resolveAnalysisInputs(model.analysisInputs);
  if (draft.sources.length >= 20 || analysisSourceCounts(draft.sources)[source.type] >= limits[source.type].max) throw Error(`This model allows at most ${limits[source.type].max} ${source.type} sources. Remove a source or choose another model.`);
  return { ...draft, sources: [...draft.sources, studioAnalysisSourceSchema.parse(source)] };
}

export function studioAnalysisRequest(projectId: string, raw: StudioAnalysisDraft, model: WorkspaceModelOption | undefined): AssetFirstGenerationRequest {
  const draft = studioAnalysisDraftSchema.parse(raw);
  if (!model || model.id !== draft.modelId || model.available === false) throw Error('The selected analysis model is unavailable. Choose a configured model.');
  if (!draft.prompt.trim()) throw Error('Describe what to review first.');
  if (new Set(draft.sources.map(source => source.id)).size !== draft.sources.length) throw Error('Analysis sources must be distinct');
  validateAnalysisReferenceCounts(analysisSourceCounts(draft.sources), model.analysisInputs);
  return { version: 2, projectId, mode: 'analysis', modelId: draft.modelId, prompt: draft.prompt.trim(), references: draft.sources.map(source => ({ assetId: source.id, role: source.type === 'audio' ? 'audio_track' : 'source' })), parameters: { analysis_depth: draft.depth, max_output_tokens: VIDEO_ANALYSIS_DEFAULT_OUTPUT_TOKENS, ...draftModelOptions(draft) } };
}

/** Local URLs retain their exact IDs even outside the bounded library window. Never infer ownership from another project's URL. */
export function restoreStudioAnalysisHistory(projectId: string, item: ProjectGenerationItem, library: StudioAnalysisSource[]): StudioAnalysisDraft {
  if (item.mediaType !== 'analysis' || !item.modelId) throw Error('Choose an analysis history item');
  const sources: StudioAnalysisSource[] = [];
  for (const [type, urls] of [['image', item.referenceImages], ['video', item.referenceVideos], ['audio', item.referenceAudios ?? []]] as [AnalysisMediaKind, string[]][]) {
    for (const publicUrl of urls) {
      const local = parseLocalProjectAssetUrl(publicUrl);
      if (local && local.projectId !== projectId) throw Error('Saved source belongs to another project');
      const found = library.find(source => source.type === type && (local ? source.id === local.assetId : source.publicUrl === publicUrl));
      if (!found && !local) throw Error('A saved source is unavailable in the project library. Import it again before reusing this analysis.');
      const source = found ?? { id: local!.assetId, type, publicUrl, filename: local!.assetId };
      if (!sources.some(existing => existing.id === source.id)) sources.push(source);
    }
  }
  return studioAnalysisDraftSchema.parse({ ...newStudioAnalysisDraft(item.modelId, item.prompt ?? ''), depth: item.analysisDepth ?? 'standard', modelOptions: item.modelOptions, sources });
}
