import { z } from 'zod';
import { captionHighlightSchema, captionWordSchema, captionWordsSchema } from '../editor/caption-words';

const clipId = z.string().trim().min(1).max(160);

/** Colour the spoken word in every caption (#RRGGBB) or turn highlighting off with null. */
export const setCaptionHighlightSchema = z.object({ type: z.literal('set_caption_highlight'), color: captionHighlightSchema.nullable() }).strict();

/** Measured word timings in caption seconds; words must spell the caption text in order. null returns to estimates. */
export const setCaptionWordsSchema = z.object({ type: z.literal('set_caption_words'), clipId, words: captionWordsSchema.min(1).nullable() }).strict();

/** Build timed caption cues from absolute word timings, such as a voice provider's alignment. */
export const captionsFromWordsSchema = z
  .object({
    type: z.literal('captions_from_words'),
    words: z.array(captionWordSchema).min(1).max(5_000),
    replace: z.boolean().optional(),
    maxWords: z.number().int().min(1).max(20).optional(),
    maxSeconds: z.number().finite().min(0.5).max(10).optional(),
  })
  .strict();
