import { z } from 'zod';
export const MAX_ADAPTER_INPUT_BYTES = 512 * 1024 * 1024;
export const projectMediaPin = z.object({
  projectId: z.string().min(1), assetId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  kind: z.enum(['image', 'video', 'audio']), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(MAX_ADAPTER_INPUT_BYTES),
}).strict();
export type ProjectMediaPin = z.infer<typeof projectMediaPin>;
