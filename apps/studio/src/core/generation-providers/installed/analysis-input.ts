import { z } from 'zod';
import { validateAnalysisReferenceCounts, type AnalysisInputs } from '../analysis-inputs';

const urls = z.array(z.string().url().max(4096)).max(20);
const inputSchema = z.object({
  prompt: z.string().trim().min(1).max(12_000),
  video_url: z.string().url().max(4096).optional(),
  video_urls: urls.optional(),
  image_urls: urls.optional(),
  audio_urls: urls.optional(),
  image_url: z.never().optional(),
  audio_url: z.never().optional(),
  analysis_depth: z.enum(['standard', 'deep']).optional(),
  max_output_tokens: z.number().int().min(256).max(8192).optional(),
}).superRefine((value, ctx) => {
  if (value.video_url && value.video_urls?.length && (value.video_urls.length !== 1 || value.video_urls[0] !== value.video_url)) ctx.addIssue({ code: 'custom', message: 'video_url must identify the sole video_urls entry' });
  const lists = [value.image_urls ?? [], value.video_urls ?? [], value.audio_urls ?? []];
  const references = lists.flat();
  if (new Set(references).size !== references.length) ctx.addIssue({ code: 'custom', message: 'Analysis reference URLs must be distinct, including across media types' });
});

/** The same validation runs before uploads and at the executable adapter boundary. */
export function validateInstalledAnalysisInput(input: unknown, declared?: AnalysisInputs) {
  const parsed = inputSchema.parse(input);
  const videoUrls = parsed.video_urls?.length ? parsed.video_urls : parsed.video_url ? [parsed.video_url] : [];
  if (parsed.video_url && [...(parsed.image_urls ?? []), ...(parsed.audio_urls ?? [])].includes(parsed.video_url)) throw Error('Analysis reference URLs must be distinct across media types');
  validateAnalysisReferenceCounts({ image: parsed.image_urls?.length ?? 0, video: videoUrls.length, audio: parsed.audio_urls?.length ?? 0 }, declared);
  return parsed;
}
