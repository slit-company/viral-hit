import { z } from 'zod';

export const instagramIdSchema = z.string().regex(/^[0-9]{1,32}$/);
export const instagramMetadataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reel'), caption: z.string().max(2200), isAiGenerated: z.boolean() }).strict(),
  z.object({ kind: z.literal('story'), isAiGenerated: z.boolean() }).strict(),
]);
export type InstagramMetadata = z.infer<typeof instagramMetadataSchema>;
export const instagramReceiptSchema = z.object({
  containerId: instagramIdSchema, instagramId: instagramIdSchema, pageId: instagramIdSchema,
  mediaId: instagramIdSchema.optional(), processingPolls: z.number().int().min(0).max(5).optional(),
  status: z.enum(['IN_PROGRESS', 'FINISHED', 'PUBLISHED', 'ERROR', 'EXPIRED']),
}).strict();
export type InstagramReceipt = z.infer<typeof instagramReceiptSchema>;
export const instagramCheckpointSchema = z.object({
  containerId: instagramIdSchema, instagramId: instagramIdSchema, pageId: instagramIdSchema,
  nextByte: z.number().int().nonnegative(),
}).strict();
export type InstagramCheckpoint = z.infer<typeof instagramCheckpointSchema>;
export type InstagramContainer = {
  id: string; status: InstagramReceipt['status'];
  upload?: { status: 'not_started' | 'in_progress' | 'complete' | 'error'; bytesTransferred: number };
};
