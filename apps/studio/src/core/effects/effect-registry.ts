import {
  getGenerationModelBindingByEffectId,
  resolveProviderUpstreamModel,
} from '@/core/generation-providers/catalog';
import { IMAGE_MODEL_ENTRIES } from './effect-registry-images';
import { VIDEO_MODEL_ENTRIES } from './effect-registry-videos';

export type WorkspaceRegistryType = 'ai-video' | 'ai-image' | 'ai-audio';

type WorkspaceRegistryModelMode = 'quality' | 'fast' | 'lite';
type WorkspaceRegistryModelVariant = 'standard' | 'pro';
type WorkspaceRegistryDuration = `${number}s`;
type WorkspaceRegistryAspectRatio =
  | '16:9'
  | '21:9'
  | '4:3'
  | '5:4'
  | '9:16'
  | '9:21'
  | '3:4'
  | '1:1'
  | '1:2'
  | '2:1'
  | '1:3'
  | '3:1'
  | '2:3'
  | '3:2'
  | '4:5'
  | 'auto'
  | 'adaptive'
  | 'landscape'
  | 'portrait';
type WorkspaceRegistryQualityOption = 'standard' | 'high' | 'low' | 'medium';
type WorkspaceRegistryAudioSetting = 'auto' | 'origin';
type WorkspaceRegistryLanguage = 'zh' | 'en';
type WorkspaceRegistryOutputQuality =
  | '1k'
  | '2k'
  | '480p'
  | '720p'
  | '768p'
  | '1080p'
  | '4k'
  | 'std'
  | 'pro';
type WorkspaceRegistryReferenceType = 'image' | 'video';
export type WorkspaceRegistryBackgroundSource = 'input_image' | 'input_video';
export type WorkspaceRegistryCharacterOrientation = 'image' | 'video';

export type WorkspaceModelMode = WorkspaceRegistryModelMode;
export type WorkspaceModelVariant = WorkspaceRegistryModelVariant;
export type WorkspaceDuration = WorkspaceRegistryDuration;
export type WorkspaceAspectRatio = WorkspaceRegistryAspectRatio;
export type WorkspaceQualityOption = WorkspaceRegistryQualityOption;
export type WorkspaceAudioSetting = WorkspaceRegistryAudioSetting;
export type WorkspaceLanguage = WorkspaceRegistryLanguage;
export type WorkspaceOutputQuality = WorkspaceRegistryOutputQuality;

export type WorkspaceEffectRegistryAliasDefaults = {
  defaultMode?: WorkspaceRegistryModelMode;
  defaultVariant?: WorkspaceRegistryModelVariant;
};

export type WorkspaceEffectRegistryEntry = {
  id: string;
  name: string;
  workspaceType: WorkspaceRegistryType;
  routeSlug: string | null;
  routeAliases?: string[];
  routeOrder?: number;
  defaultMode?: WorkspaceRegistryModelMode;
  modeOptions?: WorkspaceRegistryModelMode[];
  defaultVariant?: WorkspaceRegistryModelVariant;
  variantOptions?: WorkspaceRegistryModelVariant[];
  defaultDuration?: WorkspaceRegistryDuration;
  supportedDurations?: WorkspaceRegistryDuration[];
  defaultAspectRatio?: WorkspaceRegistryAspectRatio;
  supportedAspectRatios?: WorkspaceRegistryAspectRatio[];
  referenceOnlyAspectRatios?: WorkspaceRegistryAspectRatio[];
  defaultOutputQuality?: WorkspaceRegistryOutputQuality;
  supportedOutputQualities?: WorkspaceRegistryOutputQuality[];
  defaultQuality?: WorkspaceRegistryQualityOption;
  qualityOptions?: WorkspaceRegistryQualityOption[];
  defaultAudioSetting?: WorkspaceRegistryAudioSetting;
  audioSettingOptions?: WorkspaceRegistryAudioSetting[];
  defaultLanguage?: WorkspaceRegistryLanguage;
  supportedLanguages?: WorkspaceRegistryLanguage[];
  defaultCharacterOrientation?: WorkspaceRegistryCharacterOrientation;
  characterOrientationOptions?: WorkspaceRegistryCharacterOrientation[];
  defaultBackgroundSource?: WorkspaceRegistryBackgroundSource;
  backgroundSourceOptions?: WorkspaceRegistryBackgroundSource[];
  requiresSourceVideoDuration?: boolean;
  requiresImageInput?: boolean;
  supportsSeed?: boolean;
  referenceInputDefaultsByType?: Partial<
    Record<
      WorkspaceRegistryReferenceType,
      {
        backgroundSource?: WorkspaceRegistryBackgroundSource;
        characterOrientation?: WorkspaceRegistryCharacterOrientation;
      }
    >
  >;
  modelAliases?: string[];
  aliasDefaults?: Record<string, WorkspaceEffectRegistryAliasDefaults>;
};

/** Built-in models; installed providers add theirs at runtime on the server. */
export const WORKSPACE_EFFECT_REGISTRY: readonly WorkspaceEffectRegistryEntry[] = [...IMAGE_MODEL_ENTRIES, ...VIDEO_MODEL_ENTRIES];

const WORKSPACE_EFFECT_REGISTRY_BY_ID = new Map(
  WORKSPACE_EFFECT_REGISTRY.map((entry) => [entry.id, entry])
);

const WORKSPACE_EFFECT_REGISTRY_BY_ALIAS = new Map(
  WORKSPACE_EFFECT_REGISTRY.flatMap((entry) =>
    (entry.modelAliases ?? []).map((alias) => [alias, entry] as const)
  )
);

const INSTALLED_ENTRIES = new Map<string, WorkspaceEffectRegistryEntry>();

/** Server only: a model declared by an installed provider. Browser bundles keep the built-in list. */
export function registerInstalledWorkspaceEffectEntry(entry: WorkspaceEffectRegistryEntry) {
  if (getWorkspaceEffectRegistryEntry(entry.id)) throw new Error(`Model ${entry.id} is already registered.`);
  INSTALLED_ENTRIES.set(entry.id, entry);
}

export const listWorkspaceEffectRegistryEntries = (): WorkspaceEffectRegistryEntry[] => [...WORKSPACE_EFFECT_REGISTRY, ...INSTALLED_ENTRIES.values()];

export const getWorkspaceEffectRegistryEntry = (
  modelId: string
): WorkspaceEffectRegistryEntry | null =>
  WORKSPACE_EFFECT_REGISTRY_BY_ID.get(modelId) ??
  WORKSPACE_EFFECT_REGISTRY_BY_ALIAS.get(modelId) ??
  INSTALLED_ENTRIES.get(modelId) ??
  null;

export const getWorkspaceEffectRegistryEntryByEffectId = (
  effectId: number,
  providerId?: string
): WorkspaceEffectRegistryEntry | null => {
  const binding = getGenerationModelBindingByEffectId({ effectId, providerId });
  return binding ? getWorkspaceEffectRegistryEntry(binding.modelId) : null;
};

export const resolveWorkspaceEffectProviderModelVariant = ({
  modelId,
  variant,
}: {
  modelId: string;
  variant?: WorkspaceRegistryModelVariant | null;
}): string => {
  return resolveProviderUpstreamModel({ modelId, variant });
};

export const getWorkspaceEffectReferenceInputDefaults = ({
  modelId,
  referenceType,
}: {
  modelId: string;
  referenceType?: WorkspaceRegistryReferenceType | null;
}) => {
  const entry = getWorkspaceEffectRegistryEntry(modelId);
  if (!entry || !referenceType) {
    return null;
  }

  return entry.referenceInputDefaultsByType?.[referenceType] ?? null;
};

export const getWorkspaceEffectRegistryEntriesByType = (
  workspaceType: WorkspaceRegistryType
): WorkspaceEffectRegistryEntry[] =>
  listWorkspaceEffectRegistryEntries().filter(
    (entry) => entry.workspaceType === workspaceType
  );

export const getRoutableWorkspaceEffectRegistryEntriesByType = (
  workspaceType: WorkspaceRegistryType
): Array<WorkspaceEffectRegistryEntry & { routeSlug: string }> =>
  WORKSPACE_EFFECT_REGISTRY.filter(
    (entry): entry is WorkspaceEffectRegistryEntry & { routeSlug: string } =>
      entry.workspaceType === workspaceType &&
      typeof entry.routeSlug === 'string'
  ).sort((left, right) => (left.routeOrder ?? 0) - (right.routeOrder ?? 0));
