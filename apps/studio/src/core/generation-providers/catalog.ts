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
/** Providers an operator installed; their models are offered next to the active provider's. */
const installed = new Set<string>();
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

/** Server only: metadata of a provider loaded from VIRAL_HIT_PROVIDERS_DIR. */
export function registerInstalledGenerationProviderMetadata(provider: GenerationProviderMetadata) {
  ensureProvidersRegistered();
  addProvider(provider);
  installed.add(provider.id.trim());
}

/** The active provider first, then installed providers; their model and effect ids never overlap. */
export function listSelectableGenerationProviders() {
  ensureProvidersRegistered();
  return [getActiveGenerationProviderId(), ...installed].flatMap((id) => providers.get(id) ?? []);
}

export function isInstalledGenerationProvider(providerId: string) {
  return installed.has(providerId);
}

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

/** Without a provider id, looks in the active provider and then in installed providers. */
export function getGenerationModelBinding({
  modelId,
  providerId,
}: {
  modelId: string;
  providerId?: string;
}): GenerationProviderModelBinding | null {
  return findGenerationModelBinding({ modelId, providerId })?.binding ?? null;
}

export function getGenerationModelBindingByEffectId({
  effectId,
  providerId,
}: {
  effectId: number;
  providerId?: string;
}): GenerationProviderModelBinding | null {
  return findGenerationModelBinding({ effectId, providerId })?.binding ?? null;
}

/** Finds which provider serves a model or effect id, together with its binding. */
export function findGenerationModelBinding({
  modelId,
  effectId,
  providerId,
}: {
  modelId?: string;
  effectId?: number;
  providerId?: string;
}): { providerId: string; binding: GenerationProviderModelBinding } | null {
  const candidates = providerId ? [getGenerationProviderMetadata(providerId)].flatMap((item) => item ?? []) : listSelectableGenerationProviders();
  for (const provider of candidates) {
    const binding = provider.modelBindings.find((item) => (modelId !== undefined ? item.modelId === modelId : item.effectId === effectId));
    if (binding) return { providerId: provider.id, binding };
  }
  return null;
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
