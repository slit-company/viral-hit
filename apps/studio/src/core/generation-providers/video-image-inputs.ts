import { z } from 'zod';

/**
 * Counts alone cannot distinguish two keyframes from two character references. A video provider
 * may declare the two supported interpretations independently; omission makes no frame claim.
 */
export const videoImageInputsSchema = z.object({
  frames: z.number().int().min(1).max(2).optional(),
  references: z.number().int().min(1).max(20).optional(),
}).strict().refine(value => value.frames !== undefined || value.references !== undefined, 'Declare a video image input mode');
export type VideoImageInputs = z.infer<typeof videoImageInputsSchema>;
