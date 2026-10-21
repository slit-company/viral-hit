import { resolveAudioReferenceInputs, validateReferenceCounts } from '../generation-providers/reference-inputs';
import { studioMediaSourceSchema, studioSourceCounts, appendStudioSource, restoreStudioSources, type StudioMediaSource } from './studio-media-sources';
import { z } from 'zod';
import { draftModelOptions, modelOptionsDraftSchema } from '../generation-providers/model-controls';
import type { WorkspaceModelOption } from '../effects/workspace-models';
import type { ProjectGenerationItem } from '../effects/project-generations';
import type { AssetFirstGenerationRequest } from '../commands/generation-contract';
import { MAX_GENERATION_PROMPT_CHARS } from '../effects/validation';

export const studioAudioDraftSchema = z.object({
  version: z.literal(1), modelId: z.string().max(200),
  prompt: z.string().max(MAX_GENERATION_PROMPT_CHARS), sources: z.array(studioMediaSourceSchema).max(20).default([]), modelOptions: modelOptionsDraftSchema.optional(),
}).strict();
export type StudioAudioDraft = z.infer<typeof studioAudioDraftSchema>;
export const newStudioAudioDraft = (modelId = '', prompt = ''): StudioAudioDraft => ({ version: 1, modelId, prompt, sources: [] });

export function studioAudioRequest(projectId: string, raw: StudioAudioDraft, model: WorkspaceModelOption | undefined): AssetFirstGenerationRequest {
  const draft = studioAudioDraftSchema.parse(raw);
  if (!model || model.id !== draft.modelId || model.available === false) throw Error('Choose a configured audio model.');
  if (!draft.prompt.trim()) throw Error('Describe the audio or enter the words to speak.');
  if (new Set(draft.sources.map(source => source.id)).size !== draft.sources.length) throw Error('Audio sources must be distinct');
  validateReferenceCounts(studioSourceCounts(draft.sources), resolveAudioReferenceInputs(model.referenceInputs), 'Audio');
  return { version: 2, projectId, mode: 'audio', modelId: model.id, prompt: draft.prompt.trim(), references: draft.sources.map(source => ({ assetId: source.id, role: source.type === 'audio' ? 'audio_track' : 'source' })), parameters: draftModelOptions(draft) };
}

export function restoreStudioAudioHistory(projectId: string, item: ProjectGenerationItem, library: StudioMediaSource[]): StudioAudioDraft {
  if (item.mediaType !== 'audio' || !item.modelId) throw Error('Choose an audio history item.');
  return studioAudioDraftSchema.parse({ ...newStudioAudioDraft(item.modelId, item.prompt ?? ''), modelOptions: item.modelOptions, sources: restoreStudioSources(projectId, item, library) });
}

export function appendAudioSource(draft: StudioAudioDraft, source: StudioMediaSource, model: WorkspaceModelOption): StudioAudioDraft {
  return appendStudioSource(draft, source, resolveAudioReferenceInputs(model.referenceInputs));
}
