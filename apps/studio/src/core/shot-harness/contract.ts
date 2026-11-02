import { z } from 'zod';
import { shotSpec, type ShotSpec } from './spec';
import { characterId } from '../characters/contract';

export const SHOT_REQUEST_PREFIX = 'shot:';
const assetId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
/** Where a run belongs in a Cinema sequence; omit for a standalone shot. Reusing shotId adds another attempt of that shot. */
export const shotSequence = z.object({ id: z.string().uuid(), shotId: z.string().uuid().optional(), continuesFrom: assetId.optional() }).strict();
export type ShotSequenceInput = z.infer<typeof shotSequence>;
export const shotRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('preview'), spec: shotSpec }).strict(),
  z.object({ action: z.literal('produce'), spec: shotSpec, requestId: z.string().uuid(), sequence: shotSequence.optional() }).strict(),
  z.object({ action: z.literal('quality'), assetId, durationSec: z.number().min(0).max(120).optional(), audio: z.boolean().optional() }).strict(),
  /** Extract a take's last frame as a project image so the next shot can start where it ended. */
  z.object({ action: z.literal('continue'), assetId }).strict(),
  /** Compare the faces in project images or takes with a character or with reference images, locally. */
  z.object({ action: z.literal('face'), assetIds: z.array(assetId).min(1).max(12), referenceAssetIds: z.array(assetId).min(1).max(8).optional(), characterId: characterId.optional() }).strict(),
]);
export type ShotRequest = z.infer<typeof shotRequest>;

export type ShotTakeView = { jobId: string; nodeId: string; state: string; error: string | null; assetId?: string; url?: string };
export type ShotRunView = {
  runId: string; requestId: string; createdAt: number;
  prompt: string; modelId: string; stillModelId: string | null;
  durationSec: number | null; audio: boolean;
  still: ShotTakeView | null; takes: ShotTakeView[];
  /** Sequence placement; a run produced before sequences existed is its own one-shot sequence. */
  sequenceId: string; shotId: string; position: number; attempt: number;
  spec: ShotSpec | null; continuesFrom: string | null;
};
