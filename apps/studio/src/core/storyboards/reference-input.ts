import { z } from 'zod';
const identity = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const referenceJob = z.object({ runId: identity, jobId: identity, outputSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const prepareReference = z.object({
  action: z.literal('prepare-reference'), scenes: referenceJob, transcript: referenceJob.optional(),
  firstScene: z.number().int().min(0).max(63), lastScene: z.number().int().min(0).max(63),
  title: z.string().trim().min(1).max(120), intent: z.string().trim().min(1).max(4000), scope: z.enum(['general', 'specialized']),
}).strict();
export type PrepareReference = z.infer<typeof prepareReference>;
export type ReferenceJob = z.infer<typeof referenceJob>;
export type ReferenceSource = ReferenceJob & { assetId: string; sha256: string; kind: 'scenes' | 'transcript'; label: string; count: number; start: number; end: number };
export type ReferenceSources = { sources: ReferenceSource[]; omitted: number };
export const referenceEvidence = z.object({ ...referenceJob.shape, kind: z.enum(['scene-detection', 'speech-transcript']), engine: z.string().min(1).max(200) }).strict();
