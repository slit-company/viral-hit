import { z } from 'zod';
import { resolveAnalysisInputs, validateAnalysisReferenceCounts } from '../generation-providers/analysis-inputs';
import { draftModelOptions, modelOptionsDraftSchema } from '../generation-providers/model-controls';
import { VIDEO_ANALYSIS_DEFAULT_OUTPUT_TOKENS, VIDEO_ANALYSIS_MODEL_ID } from '../effects/video-analysis';
import type { WorkspaceModelOption } from '../effects/workspace-models';
import type { ProjectGenerationItem } from '../effects/project-generations';
import { studioMediaSourceSchema, studioSourceCounts, appendStudioSource, restoreStudioSources, type StudioMediaSource } from './studio-media-sources';
import type { AssetFirstGenerationRequest } from '../commands/generation-contract';

export const studioAnalysisSourceSchema = studioMediaSourceSchema;
export type StudioAnalysisSource = StudioMediaSource;
export const studioAnalysisDraftSchema = z.object({
  version: z.literal(1), modelId: z.string().min(1).max(200), prompt: z.string().max(12_000),
  depth: z.enum(['standard', 'deep']), modelOptions: modelOptionsDraftSchema.optional(),
  sources: z.array(studioAnalysisSourceSchema).max(20),
}).strict();
export type StudioAnalysisDraft = z.infer<typeof studioAnalysisDraftSchema>;
export const newStudioAnalysisDraft = (modelId = VIDEO_ANALYSIS_MODEL_ID, prompt = ''): StudioAnalysisDraft => ({ version: 1, modelId, prompt, depth: 'standard', sources: [] });
export const analysisSourceCounts = studioSourceCounts;

export function appendAnalysisSource(draft: StudioAnalysisDraft, source: StudioAnalysisSource, model: WorkspaceModelOption): StudioAnalysisDraft {
  return appendStudioSource(draft, source, resolveAnalysisInputs(model.analysisInputs));
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
  const sources = restoreStudioSources(projectId, item, library);
  return studioAnalysisDraftSchema.parse({ ...newStudioAnalysisDraft(item.modelId, item.prompt ?? ''), depth: item.analysisDepth ?? 'standard', modelOptions: item.modelOptions, sources });
}
