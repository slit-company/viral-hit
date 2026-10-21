import { z } from 'zod';
import { overlayMotionSchema, overlayTransformSchema } from '../editor/overlay-motion';
const clipId = z.string().trim().min(1).max(160);
const time = z.number().finite().min(0).max(86_400);
export const setOverlayMotionSchema = z.object({ type: z.literal('set_overlay_motion'), clipId, motion: overlayMotionSchema.nullable() }).strict();
export const updateOverlaySchema = z.object({
  type: z.literal('update_overlay'), clipId, atTime: time.optional(),
  patch: overlayTransformSchema.partial().extend({ fadeIn: time.optional(), fadeOut: time.optional() }).strict()
    .refine(value => Object.keys(value).length > 0, { message: 'Overlay update must include at least one field.' }),
}).strict();

export const addOverlaySchema = z.object({
  type: z.literal('add_overlay'), clipId: z.string().trim().min(1).max(200),
  assetId: z.string().trim().min(1).max(200), sourceUrl: z.string().trim().max(4096).optional().default(''),
  name: z.string().trim().min(1).max(240), startTime: time, duration: time.positive(),
  sourceType: z.enum(['image','video']).optional(), sourceDuration: time.positive().optional(), inPoint: time.optional(),
  ...overlayTransformSchema.partial().shape, fadeIn: time.optional(), fadeOut: time.optional(),
}).strict().refine(value => value.sourceType !== 'video' || (value.sourceDuration !== undefined && (value.inPoint ?? 0) + value.duration <= value.sourceDuration), 'Video overlay must fit its declared source duration');
export type OverlaySource = Omit<z.infer<typeof addOverlaySchema>, 'type' | 'clipId' | 'sourceUrl'> & { clipId?: string; sourceUrl?: string };
