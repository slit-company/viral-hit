import { z } from 'zod';
import { assetFirstGenerationRequestSchema } from '../commands/generation-contract';

export const assetGenerationRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect'), projectId: z.string().min(1).max(200), generationIntentToken: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('prepare'), generation: assetFirstGenerationRequestSchema }).strict(),
  z.object({ action: z.literal('submit'), generation: assetFirstGenerationRequestSchema,
    generationIntentToken: z.string().min(1).max(200), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
]);
