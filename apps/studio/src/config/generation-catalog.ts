import type { GenerationProviderMetadata } from '@/core/generation-providers/contracts';

/** Public model capabilities only. Never import executable adapters or credentials here. */
export const ACTIVE_GENERATION_PROVIDER_ID = 'cloud-api';
export function registerProjectGenerationCatalog(_register: (metadata: GenerationProviderMetadata) => void) {}
