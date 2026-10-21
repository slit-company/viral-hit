import { referenceInputsSchema, REFERENCE_MEDIA_KINDS, type ReferenceMediaKind, type ReferenceInputs, validateReferenceCounts } from './reference-inputs';

export const ANALYSIS_MEDIA_KINDS = REFERENCE_MEDIA_KINDS;
export type AnalysisMediaKind = ReferenceMediaKind;
export const analysisInputsSchema = referenceInputsSchema;
export type AnalysisInputs = ReferenceInputs;

export function resolveAnalysisInputs(declared?: AnalysisInputs): AnalysisInputs {
  return declared ?? { image: { min: 0, max: 0 }, video: { min: 1, max: 1 }, audio: { min: 0, max: 0 } };
}

export function validateAnalysisReferenceCounts(counts: Record<AnalysisMediaKind, number>, declared?: AnalysisInputs) {
  const inputs = resolveAnalysisInputs(declared);
  if (ANALYSIS_MEDIA_KINDS.reduce((sum, kind) => sum + counts[kind], 0) < 1) throw Error('Analysis requires at least one media reference');
  validateReferenceCounts(counts, inputs, 'Analysis');
}

/** Legacy v1 reports have one timeline, without a per-observation source identity. */
export function singleAnalysisVideo(input: Record<string, unknown>): string | null {
  if ([input.image_urls, input.audio_urls].some(value => Array.isArray(value) && value.length > 0)) return null;
  const videos = Array.isArray(input.video_urls) ? input.video_urls : [];
  if (videos.length > 1 || videos.some(value => typeof value !== 'string')) return null;
  const singular = typeof input.video_url === 'string' ? input.video_url : null;
  if (singular && videos.length && singular !== videos[0]) return null;
  return singular ?? (typeof videos[0] === 'string' ? videos[0] : null);
}
