import { z } from 'zod';
import { projectMediaPin } from '../harness/project-media-input-schema';

export const youtubeReferenceInput = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  height: z.number().int().min(144).max(1080).default(720),
  engine: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
const deferredPin = z.object({ projectId: z.null(), assetId: z.null(), kind: z.null(), sha256: z.null(), sizeBytes: z.null() }).strict();
export const sampleReferenceInput = z.object({
  assetId: z.string().max(128),
  pin: z.union([projectMediaPin, deferredPin]).optional(),
}).strict();
const asset = z.object({
  assetId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(256 * 1024 * 1024), kind: z.enum(['image', 'video']),
  publicUrl: z.string().max(1000), width: z.number().int().positive(), height: z.number().int().positive(),
  durationMs: z.number().positive().nullable(), hasAudio: z.boolean(),
}).strict();
export const referenceReceipt = z.object({
  schemaVersion: z.literal(1), source: z.enum(['youtube', 'instagram-direct', 'local']),
  sourceKey: z.string().regex(/^[a-f0-9]{64}$/), original: asset,
  samples: z.array(asset.extend({ atMs: z.number().int().nonnegative() })).length(5),
  analysisScope: z.literal('five-sampled-frames'),
}).strict();
export const referenceOutput = asset.extend({
  projectId: z.string().min(1), mediaMaterialized: z.literal(true),
  reference: referenceReceipt.pick({ source: true, sourceKey: true, analysisScope: true, samples: true }),
}).strict();
export function readReferenceOutput(raw: string | null) {
  if (!raw) return null;
  try { const parsed = referenceOutput.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
