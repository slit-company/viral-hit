import {
  ACTIVE_GENERATION_PROVIDER_ID,
  registerProjectGenerationCatalog,
} from '@/config/generation-catalog';

import { cloudApiMetadata, CLOUD_API_PROVIDER_ID } from './cloud-api-catalog';
import type {
  GenerationProviderMetadata,
  GenerationProviderModelBinding,
} from './contracts';

const providers = new Map<string, GenerationProviderMetadata>();
let initialized = false;

function addProvider(provider: GenerationProviderMetadata) {
  const id = provider.id.trim();
  if (!id) throw new Error('Generation provider id is required.');
  if (providers.has(id)) {
    throw new Error(`Generation provider ${id} is already registered.`);
  }
  const modelIds = new Set<string>();
  const effectIds = new Set<number>();
  for (const binding of provider.modelBindings) {
    if (modelIds.has(binding.modelId)) {
      throw new Error(`Provider ${id} has duplicate model ${binding.modelId}.`);
    }
    if (effectIds.has(binding.effectId)) {
      throw new Error(`Provider ${id} has duplicate effect id ${binding.effectId}.`);
    }
    modelIds.add(binding.modelId);
    effectIds.add(binding.effectId);
  }
  providers.set(id, { ...provider, id });
}

function ensureProvidersRegistered() {
  if (initialized) return;
  initialized = true;
  addProvider(cloudApiMetadata);
  addProvider({
    id: 'mock',
    label: 'Mock',
    supports: ['image', 'video'],
    modelBindings: [],
  });
  registerProjectGenerationCatalog(addProvider);
}

export const registerGenerationProviderMetadata = addProvider;

export function listGenerationProviders() {
  ensureProvidersRegistered();
  return [...providers.values()];
}

export function getGenerationProviderMetadata(providerId: string) {
  ensureProvidersRegistered();
  return providers.get(providerId) ?? null;
}

export function getActiveGenerationProviderId() {
  ensureProvidersRegistered();
  const requested = ACTIVE_GENERATION_PROVIDER_ID.trim() || CLOUD_API_PROVIDER_ID;
  if (!providers.has(requested)) {
    throw new Error(
      `Generation provider ${requested} is not registered. Register its public metadata and select it in src/config/generation-catalog.ts.`
    );
  }
  return requested;
}

export function getActiveGenerationProviderMetadata() {
  const providerId = getActiveGenerationProviderId();
  const provider = getGenerationProviderMetadata(providerId);
  if (!provider) throw new Error(`Generation provider ${providerId} is not registered.`);
  return provider;
}

export function getGenerationModelBinding({
  modelId,
  providerId = getActiveGenerationProviderId(),
}: {
  modelId: string;
  providerId?: string;
}): GenerationProviderModelBinding | null {
  const provider = getGenerationProviderMetadata(providerId);
  return provider?.modelBindings.find((binding) => binding.modelId === modelId) ?? null;
}

export function getGenerationModelBindingByEffectId({
  effectId,
  providerId = getActiveGenerationProviderId(),
}: {
  effectId: number;
  providerId?: string;
}): GenerationProviderModelBinding | null {
  const provider = getGenerationProviderMetadata(providerId);
  return provider?.modelBindings.find((binding) => binding.effectId === effectId) ?? null;
}

export function resolveProviderUpstreamModel({
  modelId,
  variant,
  providerId,
}: {
  modelId: string;
  variant?: string | null;
  providerId?: string;
}) {
  const binding = getGenerationModelBinding({ modelId, providerId });
  if (!binding) return modelId;
  return (variant && binding.upstreamModelByVariant?.[variant]) || binding.upstreamModelId;
}
