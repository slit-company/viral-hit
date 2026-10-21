import { z } from 'zod';
import { MAX_GENERATION_PROMPT_CHARS } from '@/core/effects/validation';
import { validateReferenceCounts } from '../reference-inputs';
import type { ProviderModel } from './manifest';

const urls = z.array(z.string().url().max(4096)).max(30).optional();
const visualInput = z.object({
  prompt: z.string().trim().min(1).max(MAX_GENERATION_PROMPT_CHARS),
  image_urls: urls, video_urls: urls, audio_urls: urls,
  image_url: z.never().optional(), video_url: z.never().optional(), audio_url: z.never().optional(),
  first_frame: z.never().optional(), last_frame: z.never().optional(),
  aspect_ratio: z.string().optional(), wmDuration: z.string().optional(),
}).superRefine((input, ctx) => {
  const references = [...(input.image_urls ?? []), ...(input.video_urls ?? []), ...(input.audio_urls ?? [])];
  if (new Set(references).size !== references.length) ctx.addIssue({ code: 'custom', message: 'Visual references must be distinct across media types' });
});

/** Check both admission and adapter entry, before any installed module is imported. */
export function validateInstalledVisualInput(input: unknown, model: ProviderModel) {
  const parsed = visualInput.parse(input);
  const limits = model.referenceInputs ?? { image: { min: model.requiresImageInput ? 1 : 0, max: model.maxReferenceImages }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 } };
  validateReferenceCounts({ image: parsed.image_urls?.length ?? 0, video: parsed.video_urls?.length ?? 0, audio: parsed.audio_urls?.length ?? 0 }, limits, model.name);
  if (parsed.aspect_ratio !== undefined && !model.aspectRatios.includes(parsed.aspect_ratio as ProviderModel['aspectRatios'][number])) throw Error('Choose an aspect ratio declared by this model');
  if (parsed.wmDuration !== undefined && !model.durations?.includes(parsed.wmDuration)) throw Error('Choose a duration declared by this model');
  return parsed;
}
