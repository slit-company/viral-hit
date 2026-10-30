/** Product operations are independent of provider names, endpoints and model IDs. */
export const STUDIO_TOOL_KINDS = {
  'image-generate': 'image',
  'image-edit': 'image',
  'remove-background': 'image',
  'image-upscale': 'image',
  'video-generate': 'video',
  'video-edit': 'video',
  'motion-control': 'video',
  'motion-transfer': 'video',
  'object-swap': 'video',
  restyle: 'video',
  'image-lipsync': 'video',
  'video-lipsync': 'video',
  'text-to-speech': 'audio',
  'voice-change': 'audio',
  'audio-generate': 'audio',
  'music-generate': 'audio',
  'video-caption': 'video',
  'video-dubbing': 'video',
  'video-upscale': 'video',
  'media-analysis': 'analysis',
} as const;
export type StudioToolId = keyof typeof STUDIO_TOOL_KINDS;
export const STUDIO_TOOL_IDS = Object.keys(STUDIO_TOOL_KINDS) as [
  StudioToolId,
  ...StudioToolId[],
];
export const defaultStudioTool = (kind: string): StudioToolId =>
  kind === 'video'
    ? 'video-generate'
    : kind === 'audio'
      ? 'audio-generate'
      : kind === 'analysis'
        ? 'media-analysis'
        : 'image-generate';
export function modelStudioTools(model: {
  studioTasks?: readonly StudioToolId[];
  workspaceType: string;
  referenceInputs?: { image?: { min: number } };
  maskInput?: { required?: boolean };
}) {
  if (model.studioTasks?.length) return model.studioTasks;
  const kind = model.workspaceType.replace('ai-', '');
  // An undeclared image model that cannot run without a source image or mask edits images; it must not become the default for creating one.
  if (kind === 'image' && ((model.referenceInputs?.image?.min ?? 0) > 0 || model.maskInput?.required)) return ['image-edit'] as const;
  return [defaultStudioTool(kind)];
}
export function toolModels<
  T extends {
    studioTasks?: readonly StudioToolId[];
    workspaceType: string;
    providerId?: string;
  },
>(models: readonly T[], tool: StudioToolId, provider = '') {
  return models.filter(
    (model) =>
      modelStudioTools(model).includes(tool) &&
      (!provider || model.providerId === provider),
  );
}
export function chooseToolModel<
  T extends { id: string; available?: boolean; providerId?: string },
>(
  models: readonly T[],
  preferredProvider?: string,
  preferredId?: string,
): T | null {
  const candidates =
    preferredProvider &&
    models.some((model) => model.providerId === preferredProvider)
      ? models.filter((model) => model.providerId === preferredProvider)
      : models;
  return (
    candidates.find((model) => model.id === preferredId) ??
    candidates.find((model) => model.available !== false) ??
    candidates[0] ??
    null
  );
}
