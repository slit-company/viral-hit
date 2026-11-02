import { z } from 'zod';

export const instagramIdSchema = z.string().regex(/^[0-9]{1,32}$/);
const schedule = { publishAt: z.iso.datetime({ offset: true }).optional() };
/** Meta limits: 2,200 characters, 30 hashtags and 20 @ mentions. */
const caption = z.string().max(2200)
  .refine(text => (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length <= 30, 'Use at most 30 hashtags')
  .refine(text => (text.match(/@[A-Za-z0-9._]+/g) ?? []).length <= 20, 'Mention at most 20 accounts');
const altText = z.string().max(1000);
/** fill crops to the frame; fit keeps the whole image over a blurred copy of itself. */
export const instagramFrameSchema = z.enum(['fill', 'fit']);
export type InstagramFrame = z.infer<typeof instagramFrameSchema>;
export const INSTAGRAM_CAROUSEL_LIMIT = 20;
export const instagramMetadataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reel'), caption, isAiGenerated: z.boolean(), ...schedule }).strict(),
  z.object({ kind: z.literal('story'), isAiGenerated: z.boolean(), frame: instagramFrameSchema.optional(), ...schedule }).strict(),
  z.object({ kind: z.literal('image'), caption, altText: altText.optional(), frame: instagramFrameSchema.optional(), isAiGenerated: z.boolean(), ...schedule }).strict(),
  z.object({ kind: z.literal('carousel'), caption, altTexts: z.array(altText).max(INSTAGRAM_CAROUSEL_LIMIT).optional(), frame: instagramFrameSchema.optional(), isAiGenerated: z.boolean(), ...schedule }).strict(),
]);
export type InstagramMetadata = z.infer<typeof instagramMetadataSchema>;
export type InstagramKind = InstagramMetadata['kind'];
const containerStatus = z.enum(['IN_PROGRESS', 'FINISHED', 'PUBLISHED', 'ERROR', 'EXPIRED']);
export const instagramReceiptSchema = z.object({
  containerId: instagramIdSchema, instagramId: instagramIdSchema, pageId: instagramIdSchema,
  mediaId: instagramIdSchema.optional(), processingPolls: z.number().int().min(0).max(5).optional(),
  status: containerStatus,
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

/**
 * Image posts, image Stories and carousels. Every item container is created by the fenced start;
 * nextByte exists only for resumable carousel videos.
 */
export const instagramPostCheckpointSchema = z.object({
  post: z.literal(1), instagramId: instagramIdSchema, pageId: instagramIdSchema,
  items: z.array(z.object({ containerId: instagramIdSchema, nextByte: z.number().int().nonnegative().optional() }).strict()).min(1).max(INSTAGRAM_CAROUSEL_LIMIT),
}).strict();
export type InstagramPostCheckpoint = z.infer<typeof instagramPostCheckpointSchema>;
/** containerId is the publishable container: the single item, or the carousel once created. */
export const instagramPostReceiptSchema = z.object({
  post: z.literal(1), instagramId: instagramIdSchema, pageId: instagramIdSchema,
  items: z.array(instagramIdSchema).min(1).max(INSTAGRAM_CAROUSEL_LIMIT),
  containerId: instagramIdSchema.optional(), status: containerStatus, mediaId: instagramIdSchema.optional(),
  processingPolls: z.number().int().min(0).max(5).optional(), carouselPolls: z.number().int().min(0).max(20).optional(),
}).strict();
export type InstagramPostReceipt = z.infer<typeof instagramPostReceiptSchema>;
