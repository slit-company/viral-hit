import type { BaseAdapter, EffectRecord } from '@/core/adapters/base-adapter';

export type GenerationMediaCapability = 'image' | 'video' | 'audio' | 'analysis';

export type GenerationProviderModelBinding = {
  /** Stable ViralHit product model id. */
  modelId: string;
  /** Explicit output type/name for installed analysis models outside the image/video registry. */
  kind?: 'image' | 'video' | 'analysis';
  name?: string;
  /** Provider-local numeric id retained for existing DB/API compatibility. */
  effectId: number;
  /** Provider model name sent upstream. */
  upstreamModelId: string;
  uploadPath: string;
  imageBucketName: string;
  upstreamModelByVariant?: Readonly<Record<string, string>>;
};

export type GenerationProviderDefinition = {
  id: string;
  label: string;
  supports: readonly GenerationMediaCapability[];
  modelBindings: readonly GenerationProviderModelBinding[];
  createAdapter: (effect: EffectRecord) => BaseAdapter;
  assertConfigured?: () => Promise<void>;
  /** Synchronous presence check for declared server settings; does not contact a provider. */
  isConfigured?: () => boolean;
  validateInput?: (effect: EffectRecord, input: Record<string, unknown>) => void;
  /** Reads a result URL this provider returned; without it only approved Cloud API media is downloaded. */
  readOutputMedia?: (url: string, signal: AbortSignal) => Promise<Response>;
};

export type GenerationProviderRegistrar = (
  provider: GenerationProviderDefinition
) => void;

/** Browser-safe capabilities. Executable adapters and credential checks are server-only. */
export type GenerationProviderMetadata = Pick<GenerationProviderDefinition, 'id' | 'label' | 'supports' | 'modelBindings'>;
