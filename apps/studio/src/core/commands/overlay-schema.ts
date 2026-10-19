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
