import type { GenerationProviderRegistrar } from '@/core/generation-providers/contracts';

/**
 * Source-level extension point for open-source forks.
 *
 * Cloud API is registered by the core and remains the default. A fork can add a
 * server implementation here, declare its public metadata in generation-catalog.ts,
 * and change ACTIVE_GENERATION_PROVIDER_ID there.
 * Keep credentials inside that provider's server-only implementation.
 */
export { ACTIVE_GENERATION_PROVIDER_ID } from './generation-catalog';

export function registerProjectGenerationProviders(
  _register: GenerationProviderRegistrar
) {}
