import { z } from 'zod';
import { MAX_GENERATION_PROMPT_CHARS } from '@/core/effects/validation';

const noReferences = z.array(z.never()).max(0).optional();
const audioInput = z.object({
  prompt: z.string().trim().min(1).max(MAX_GENERATION_PROMPT_CHARS),
  image_urls: noReferences, video_urls: noReferences, audio_urls: noReferences,
  image_url: z.never().optional(), video_url: z.never().optional(), audio_url: z.never().optional(),
  first_frame: z.never().optional(), last_frame: z.never().optional(),
  aspect_ratio: z.never().optional(), wmDuration: z.never().optional(),
});

/** Text-to-audio models declare their own typed options, not visual generation fields. */
export function validateInstalledAudioInput(input: unknown) {
  return audioInput.parse(input);
}
