import { z } from 'zod';

export const ANALYSIS_MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export type AnalysisMediaKind = typeof ANALYSIS_MEDIA_KINDS[number];
const countRange = z.object({
  min: z.number().int().min(0).max(20),
  max: z.number().int().min(0).max(20),
}).strict().refine(range => range.min <= range.max, 'Minimum cannot exceed maximum');

/** No manifest default: omitting this field preserves existing runtime fingerprints. */
export const analysisInputsSchema = z.object({
  image: countRange,
  video: countRange,
  audio: countRange,
}).strict().superRefine((inputs, ctx) => {
  const maximum = ANALYSIS_MEDIA_KINDS.reduce((sum, kind) => sum + inputs[kind].max, 0);
  if (maximum < 1 || maximum > 20) ctx.addIssue({ code: 'custom', message: 'Analysis must allow between 1 and 20 total references' });
});
export type AnalysisInputs = z.infer<typeof analysisInputsSchema>;

export function resolveAnalysisInputs(declared?: AnalysisInputs): AnalysisInputs {
  return declared ?? { image: { min: 0, max: 0 }, video: { min: 1, max: 1 }, audio: { min: 0, max: 0 } };
}

export function validateAnalysisReferenceCounts(counts: Record<AnalysisMediaKind, number>, declared?: AnalysisInputs) {
  const inputs = resolveAnalysisInputs(declared);
  if (ANALYSIS_MEDIA_KINDS.reduce((sum, kind) => sum + counts[kind], 0) < 1) throw Error('Analysis requires at least one media reference');
  for (const kind of ANALYSIS_MEDIA_KINDS) {
    const { min, max } = inputs[kind];
    if (counts[kind] < min || counts[kind] > max) throw Error(`Analysis requires ${min}–${max} ${kind} references; received ${counts[kind]}`);
  }
}

/** A timed report currently has one timeline, not a per-observation source identity. */
export function singleAnalysisVideo(input: Record<string, unknown>): string | null {
  if ([input.image_urls, input.audio_urls].some(value => Array.isArray(value) && value.length > 0)) return null;
  const videos = Array.isArray(input.video_urls) ? input.video_urls : [];
  if (videos.length > 1 || videos.some(value => typeof value !== 'string')) return null;
  const singular = typeof input.video_url === 'string' ? input.video_url : null;
  if (singular && videos.length && singular !== videos[0]) return null;
  return singular ?? (typeof videos[0] === 'string' ? videos[0] : null);
}
