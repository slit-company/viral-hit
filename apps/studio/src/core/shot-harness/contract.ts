import { z } from 'zod';
import { shotSpec } from './spec';

export const SHOT_REQUEST_PREFIX = 'shot:';
export const shotRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('preview'), spec: shotSpec }).strict(),
  z.object({ action: z.literal('produce'), spec: shotSpec, requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('quality'), assetId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), durationSec: z.number().min(0).max(120).optional(), audio: z.boolean().optional() }).strict(),
]);
export type ShotRequest = z.infer<typeof shotRequest>;

export type ShotTakeView = { jobId: string; nodeId: string; state: string; error: string | null; assetId?: string; url?: string };
export type ShotRunView = {
  runId: string; requestId: string; createdAt: number;
  prompt: string; modelId: string; stillModelId: string | null;
  durationSec: number | null; audio: boolean;
  still: ShotTakeView | null; takes: ShotTakeView[];
};
