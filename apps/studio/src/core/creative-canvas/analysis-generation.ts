import { validateAnalysisReferenceCounts } from '@/core/generation-providers/analysis-inputs';
import { draftModelOptions } from '@/core/generation-providers/model-controls';
import { getGenerationPromptMaxChars, validateGenerationPrompt } from '@/core/effects/validation';
import { VIDEO_ANALYSIS_DEFAULT_OUTPUT_TOKENS, VIDEO_ANALYSIS_MODEL_ID } from '@/core/effects/video-analysis';
import type { WorkspaceModelOption } from '@/core/effects/workspace-models';
import type { CanvasCard, CanvasDraftCard } from './canvas-types';
import { isLocalWorkspaceMediaUrl } from './local-references';

const getVideoAnalysisModel = (
  depth: CanvasDraftCard['analysisDepth'] = 'standard',
  modelId = VIDEO_ANALYSIS_MODEL_ID
): WorkspaceModelOption => ({
  id: modelId,
  name: modelId !== VIDEO_ANALYSIS_MODEL_ID ? modelId :
    depth === 'deep'
      ? 'Video Analysis Pro'
      : 'Video Analysis Standard',
  uploadPath: 'effects/video-analysis',
  imageBucketName: 'video',
  supportsSourceVideo: true,
  maxSourceVideos: 1,
});

export function buildAnalysisGenerationInput({ draftCard, canvasCards, referenceUrlOverrides, translate, model }: {
  model?: WorkspaceModelOption;
  draftCard: CanvasDraftCard; canvasCards: Record<string, CanvasCard>; referenceUrlOverrides: Record<string, string>;
  translate: (key: string, values?: Record<string, string | number>) => string;
}) {
  const promptValidation = validateGenerationPrompt(draftCard.prompt, {
    required: true,
    maxChars: getGenerationPromptMaxChars({
      modelId: VIDEO_ANALYSIS_MODEL_ID,
    }),
  });
  if (!promptValidation.ok) {
    throw new Error(
      promptValidation.code === 'PROMPT_TOO_LONG'
        ? translate('messages.promptTooLong', {
            maxChars: promptValidation.maxChars,
          })
        : translate('messages.promptRequired')
    );
  }

  const references = [...new Set(draftCard.referenceCardIds)].map(id => canvasCards[id]);
  if (references.some(card => !card?.url || !['image', 'video', 'audio'].includes(card.type))) throw Error('Analysis sources must be available project media');
  const byKind = (kind: string) => references.filter(card => card.type === kind);
  const counts = { image: byKind('image').length, video: byKind('video').length, audio: byKind('audio').length };
  if (!model?.analysisInputs && (counts.video !== 1 || counts.image || counts.audio)) throw Error(translate('messages.analysisVideoRequired'));
  validateAnalysisReferenceCounts(counts, model?.analysisInputs);
  const input: Record<string, unknown> = {
    ...draftModelOptions(draftCard),
    prompt: promptValidation.trimmedPrompt,
    analysis_depth: draftCard.analysisDepth ?? 'standard',
    max_output_tokens: VIDEO_ANALYSIS_DEFAULT_OUTPUT_TOKENS,
  };
  for (const kind of ['image', 'video', 'audio'] as const) {
    const urls = byKind(kind).map(card => referenceUrlOverrides[card.id] ?? card.url!).filter(url => !isLocalWorkspaceMediaUrl(url));
    if (model?.analysisInputs && urls.length) input[`${kind}_urls`] = urls;
    if (kind === 'video' && urls.length === 1 && counts.video === 1) input.video_url = urls[0];
  }

  return {
    modelId: draftCard.modelId || VIDEO_ANALYSIS_MODEL_ID,
    input,
    model: model ?? getVideoAnalysisModel(draftCard.analysisDepth, draftCard.modelId || VIDEO_ANALYSIS_MODEL_ID),
  };
}
