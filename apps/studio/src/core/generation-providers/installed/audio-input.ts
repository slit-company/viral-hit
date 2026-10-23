import { z } from 'zod';
import { checkReferenceRoleEntries } from '../reference-roles';
import { MAX_GENERATION_PROMPT_CHARS } from '@/core/effects/validation';
import { resolveAudioReferenceInputs, validateReferenceCounts, type ReferenceInputs } from '../reference-inputs';

const urls = z.array(z.string().url().max(4096)).max(20).optional();
const audioInput = z.object({
  prompt: z.string().trim().min(1).max(MAX_GENERATION_PROMPT_CHARS),
  image_urls: urls, video_urls: urls, audio_urls: urls,
  image_url: z.never().optional(), video_url: z.never().optional(), audio_url: z.never().optional(),
  first_frame: z.never().optional(), last_frame: z.never().optional(),
  aspect_ratio: z.never().optional(), wmDuration: z.never().optional(),
}).superRefine((input, ctx) => {
  const references = [...(input.image_urls ?? []), ...(input.video_urls ?? []), ...(input.audio_urls ?? [])];
  if (new Set(references).size !== references.length) ctx.addIssue({ code: 'custom', message: 'Audio references must be distinct across media types' });
});

/** Repeated before upload and before module import; undeclared models remain text-only. */
export function validateInstalledAudioInput(input: unknown, declared?: ReferenceInputs) {
  const parsed = audioInput.parse(input);
  validateReferenceCounts({ image: parsed.image_urls?.length ?? 0, video: parsed.video_urls?.length ?? 0, audio: parsed.audio_urls?.length ?? 0 }, resolveAudioReferenceInputs(declared), 'Audio');
  checkReferenceRoleEntries((input as Record<string, unknown>).reference_roles, [...(parsed.image_urls ?? []), ...(parsed.video_urls ?? []), ...(parsed.audio_urls ?? [])]);
  return parsed;
}
