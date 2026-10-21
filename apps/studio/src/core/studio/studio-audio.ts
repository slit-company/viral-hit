import { z } from 'zod';
import { draftModelOptions, modelOptionsDraftSchema } from '../generation-providers/model-controls';
import type { WorkspaceModelOption } from '../effects/workspace-models';
import type { ProjectGenerationItem } from '../effects/project-generations';
import type { AssetFirstGenerationRequest } from '../commands/generation-contract';
import { MAX_GENERATION_PROMPT_CHARS } from '../effects/validation';

export const studioAudioDraftSchema = z.object({
  version: z.literal(1), modelId: z.string().max(200),
  prompt: z.string().max(MAX_GENERATION_PROMPT_CHARS), modelOptions: modelOptionsDraftSchema.optional(),
}).strict();
export type StudioAudioDraft = z.infer<typeof studioAudioDraftSchema>;
export const newStudioAudioDraft = (modelId = '', prompt = ''): StudioAudioDraft => ({ version: 1, modelId, prompt });

export function studioAudioRequest(projectId: string, raw: StudioAudioDraft, model: WorkspaceModelOption | undefined): AssetFirstGenerationRequest {
  const draft = studioAudioDraftSchema.parse(raw);
  if (!model || model.id !== draft.modelId || model.available === false) throw Error('Choose a configured audio model.');
  if (!draft.prompt.trim()) throw Error('Describe the audio or enter the words to speak.');
  return { version: 2, projectId, mode: 'audio', modelId: model.id, prompt: draft.prompt.trim(), references: [], parameters: draftModelOptions(draft) };
}

export function restoreStudioAudioHistory(item: ProjectGenerationItem): StudioAudioDraft {
  if (item.mediaType !== 'audio' || !item.modelId) throw Error('Choose an audio history item.');
  return studioAudioDraftSchema.parse({ ...newStudioAudioDraft(item.modelId, item.prompt ?? ''), modelOptions: item.modelOptions });
}
