import type { GenerationProviderModelBinding } from '@/core/generation-providers/contracts';
import type { EffectRecord } from '@/core/adapters/base-adapter';
import {
  findGenerationModelBinding,
  getActiveGenerationProviderId,
  getGenerationProviderMetadata as getGenerationProvider,
  listSelectableGenerationProviders,
} from '@/core/generation-providers/catalog';

import {
  type WorkspaceEffectRegistryEntry,
  getWorkspaceEffectRegistryEntry,
} from './effect-registry';
import { getWorkspaceMediaSchema } from './workspace-media';
import {
  VIDEO_ANALYSIS_MODEL_ID,
} from './video-analysis';

export type RegisteredEffect = EffectRecord;

const buildVideoAnalysisEffect = (
  binding: GenerationProviderModelBinding,
  providerId = getActiveGenerationProviderId()
): RegisteredEffect => {
  const provider = getGenerationProvider(providerId);
  return {
    id: binding.effectId,
    name: binding.name ?? 'Video Analysis',
    type: 3,
    model: binding.upstreamModelId,
    version: null,
    linkName: binding.modelId,
    description: `${provider?.label ?? providerId} asynchronous video analysis`,
    platform: binding.modelId,
    api: null,
    provider: providerId,
    inputSchema: {
      prompt: { type: 'string', required: true },
      video_url: { type: 'string', required: true },
      analysis_depth: {
        type: 'enum',
        required: false,
        values: ['standard', 'deep'],
      },
      max_output_tokens: { type: 'number', required: false },
    },
  };
};

const optionalAnyField = { type: 'any', required: false } as const;

const buildInputSchema = (entry: WorkspaceEffectRegistryEntry) => {
  const mediaSchema = getWorkspaceMediaSchema(entry.id);
  const schema: Record<string, unknown> = {
    prompt: { type: 'string', required: true },
  };

  if (entry.supportedAspectRatios?.length) {
    schema.aspect_ratio = {
      type: 'enum',
      required: false,
      values: entry.supportedAspectRatios,
    };
  }
  if (entry.supportedDurations?.length) {
    schema.wmDuration = {
      type: 'enum',
      required: false,
      values: entry.supportedDurations,
    };
  }
  if (entry.supportedOutputQualities?.length) {
    schema.wmOutputQuality = {
      type: 'enum',
      required: false,
      values: entry.supportedOutputQualities,
    };
  }
  if (entry.qualityOptions?.length) {
    schema.quality = {
      type: 'enum',
      required: false,
      values: entry.qualityOptions,
    };
  }
  if (entry.modeOptions?.length) {
    schema.mode = {
      type: 'enum',
      required: false,
      values: entry.modeOptions,
    };
  }
  if (entry.supportedLanguages?.length) {
    schema.language = {
      type: 'enum',
      required: false,
      values: entry.supportedLanguages,
    };
  }
  if (entry.characterOrientationOptions?.length) {
    schema.characterOrientation = {
      type: 'enum',
      required: false,
      values: entry.characterOrientationOptions,
    };
  }
  if (entry.backgroundSourceOptions?.length) {
    schema.backgroundSource = {
      type: 'enum',
      required: false,
      values: entry.backgroundSourceOptions,
    };
  }
  if (entry.requiresSourceVideoDuration) {
    schema.sourceVideoDurationSeconds = optionalAnyField;
  }
  if (entry.supportsSeed) {
    schema.seed = { type: 'number', required: false };
  }
  if (mediaSchema && mediaSchema.image.max > 0) {
    schema.image_urls = entry.requiresImageInput
      ? { type: 'any', required: true }
      : optionalAnyField;
  }
  if (mediaSchema && mediaSchema.video.max > 0) {
    schema.video_urls = optionalAnyField;
  }
  if (mediaSchema && mediaSchema.audio.max > 0) {
    schema.audio_urls = optionalAnyField;
  }

  return schema;
};

export const toRegisteredEffect = (
  entry: WorkspaceEffectRegistryEntry,
  binding: GenerationProviderModelBinding,
  providerId = getActiveGenerationProviderId()
): RegisteredEffect => {
  const isImage = entry.workspaceType === 'ai-image';
  const provider = getGenerationProvider(providerId);
  if (!provider) throw new Error(`Generation provider ${providerId} is not registered.`);

  return {
    id: binding.effectId,
    name: entry.name,
    type: isImage ? 2 : 1,
    model: binding.upstreamModelId,
    version: null,
    linkName: entry.routeSlug ?? entry.id,
    description: `${provider.label} ${entry.name}`,
    platform: provider.id,
    api: null,
    provider: provider.id,
    inputSchema: buildInputSchema(entry),
  };
};

export const listRegisteredEffects = (): RegisteredEffect[] =>
  listSelectableGenerationProviders().flatMap((provider) => provider.modelBindings.flatMap((binding) => {
    if (binding.kind === 'analysis' || binding.modelId === VIDEO_ANALYSIS_MODEL_ID) {
      return [buildVideoAnalysisEffect(binding, provider.id)];
    }
    const entry = getWorkspaceEffectRegistryEntry(binding.modelId);
    return entry ? [toRegisteredEffect(entry, binding, provider.id)] : [];
  }));

/** Without a provider id, the effect is looked up in the active provider and then installed providers. */
export const getRegisteredEffectById = (
  id: number,
  requestedProviderId?: string
): RegisteredEffect | null => {
  const found = findGenerationModelBinding({ effectId: id, providerId: requestedProviderId });
  if (!found) return null;
  const { binding, providerId } = found;
  if (binding.kind === 'analysis' || binding.modelId === VIDEO_ANALYSIS_MODEL_ID) {
    return buildVideoAnalysisEffect(binding, providerId);
  }
  const entry = getWorkspaceEffectRegistryEntry(binding.modelId);
  return entry ? toRegisteredEffect(entry, binding, providerId) : null;
};

export const getRegisteredEffectsByIds = (ids: number[]): RegisteredEffect[] => {
  const uniqueIds = [...new Set(ids)].filter((id) => Number.isFinite(id));
  return uniqueIds.flatMap((id) => {
    const effect = getRegisteredEffectById(id);
    return effect ? [effect] : [];
  });
};
