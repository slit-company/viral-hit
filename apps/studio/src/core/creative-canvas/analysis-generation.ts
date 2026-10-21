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

export function buildAnalysisGenerationInput({ draftCard, canvasCards, referenceUrlOverrides, translate }: {
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

  const videoReferences = draftCard.referenceCardIds
    .map((cardId) => canvasCards[cardId])
    .filter(
      (card): card is CanvasCard =>
        Boolean(card?.url) && card.type === 'video'
    );
  if (videoReferences.length !== 1) {
    throw new Error(translate('messages.analysisVideoRequired'));
  }

  const videoReference = videoReferences[0];
  const videoUrl = videoReference
    ? referenceUrlOverrides[videoReference.id] ?? videoReference.url
    : null;
  const input: Record<string, unknown> = {
    prompt: promptValidation.trimmedPrompt,
    analysis_depth: draftCard.analysisDepth ?? 'standard',
    max_output_tokens: VIDEO_ANALYSIS_DEFAULT_OUTPUT_TOKENS,
  };
  if (videoUrl && !isLocalWorkspaceMediaUrl(videoUrl)) {
    input.video_url = videoUrl;
  }

  return {
    modelId: draftCard.modelId || VIDEO_ANALYSIS_MODEL_ID,
    input,
    model: getVideoAnalysisModel(draftCard.analysisDepth, draftCard.modelId || VIDEO_ANALYSIS_MODEL_ID),
  };
}
