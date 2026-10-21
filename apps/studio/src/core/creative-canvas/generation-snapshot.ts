import type { CanvasGenerationCard, CanvasGenerationSnapshot } from './canvas-types';

/** Capture the settings used by an output independently of future draft edits. */
export function captureGenerationSnapshot(draft: CanvasGenerationCard, resolvedAspectRatio: CanvasGenerationCard['aspectRatio']): CanvasGenerationSnapshot {
  return {
    type: draft.type,
    generationMode: draft.generationMode,
    analysisDepth: draft.analysisDepth,
    ...(draft.modelOptions ? { modelOptions: { modelId: draft.modelOptions.modelId, values: { ...draft.modelOptions.values } } } : {}),
    prompt: draft.prompt,
    referenceCardIds: [...draft.referenceCardIds],
    workflowTemplateId: draft.workflowTemplateId,
    modelId: draft.modelId,
    aspectRatio: resolvedAspectRatio,
    outputQuality: draft.outputQuality,
    duration: draft.duration,
    language: draft.language,
    mode: draft.mode,
    variant: draft.variant,
    quality: draft.quality,
    ...(draft.characterOrientation
      ? { characterOrientation: draft.characterOrientation }
      : {}),
    ...(draft.backgroundSource
      ? { backgroundSource: draft.backgroundSource }
      : {}),
    resultText: draft.resultText ?? null,
    capturedAt: new Date().toISOString(),
  };
}
