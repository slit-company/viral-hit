import {
  registerProjectGenerationProviders,
} from '@/config/generation-providers';
import { MockAdapter } from '@/core/adapters/mock-adapter';

import { cloudApiGenerationProvider } from './cloud-api-provider';
import type {
  GenerationProviderDefinition,
} from './contracts';

import { getActiveGenerationProviderId, getGenerationProviderMetadata } from './catalog';
export { getActiveGenerationProviderId, getGenerationModelBinding, getGenerationModelBindingByEffectId, resolveProviderUpstreamModel } from './catalog';

const providers = new Map<string, GenerationProviderDefinition>();
let initialized = false;

function addProvider(provider: GenerationProviderDefinition) {
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
  const metadata = getGenerationProviderMetadata(id);
  if (!metadata || JSON.stringify([metadata.label, metadata.supports, metadata.modelBindings, metadata.referenceDelivery]) !== JSON.stringify([provider.label, provider.supports, provider.modelBindings, provider.referenceDelivery])) {
    throw new Error(`Provider ${id} must have matching public metadata in src/config/generation-catalog.ts.`);
  }
  providers.set(id, { ...provider, id });
}

function ensureProvidersRegistered() {
  if (initialized) return;
  initialized = true;
  addProvider(cloudApiGenerationProvider);
  addProvider({
    id: 'mock',
    label: 'Mock',
    supports: ['image', 'video'],
    modelBindings: [],
    createAdapter: (effect) => new MockAdapter(effect),
  });
  registerProjectGenerationProviders(addProvider);
}

export const registerGenerationProvider = addProvider;

export function listGenerationProviders() {
  ensureProvidersRegistered();
  return [...providers.values()];
}

export function getGenerationProvider(providerId: string) {
  ensureProvidersRegistered();
  return providers.get(providerId) ?? null;
}

export function getActiveGenerationProvider() {
  const providerId = getActiveGenerationProviderId();
  const provider = getGenerationProvider(providerId);
  if (!provider) throw new Error(`Generation provider ${providerId} is not registered.`);
  return provider;
}
