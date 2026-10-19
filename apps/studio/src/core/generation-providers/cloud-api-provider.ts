import {
  CloudApiAdapter,
  validateCloudApiTaskInput,
} from '@/core/adapters/cloud-api-adapter';
import { getConfig } from '@/modules/config/service';

import type { GenerationProviderDefinition } from './contracts';

import { cloudApiMetadata } from './cloud-api-catalog';
export { CLOUD_API_PROVIDER_ID, CLOUD_API_MODEL_BINDINGS } from './cloud-api-catalog';

export const cloudApiGenerationProvider: GenerationProviderDefinition = {
  ...cloudApiMetadata,
  createAdapter: (effect) => new CloudApiAdapter(effect),
  assertConfigured: async () => {
    if (!(await getConfig('CLOUD_API_KEY'))) {
      throw new Error('Connect a Cloud API API key before generating.');
    }
  },
  validateInput: (effect, input) => {
    validateCloudApiTaskInput({
      effectType: effect.type,
      model: effect.model,
      input,
    });
  },
};
