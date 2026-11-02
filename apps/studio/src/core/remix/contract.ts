import { z } from 'zod';
import { timelineTransitionSchema } from '../editor/transition-contract';

const assetId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const REMIX_REQUEST_PREFIX = 'remix:';

/** One application operation behind the Remix page, HTTP and MCP. */
export const remixRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  /** Queue visual-cut detection on a reference video (local, no credits). */
  z.object({
    action: z.literal('analyze'), assetId, requestId: z.string().uuid(),
    sensitivity: z.number().finite().min(1).max(100).default(10),
    minShot: z.number().finite().min(0.125).max(30).default(0.4),
    maxShots: z.number().int().min(1).max(64).default(48),
  }).strict(),
  /** Rebuild the reference's cut rhythm with new material at the end of the timeline. */
  z.object({
    action: z.literal('build'), requestId: z.string().uuid(),
    materials: z.array(assetId).min(1).max(64),
    keepSoundtrack: z.boolean().default(true),
    transition: timelineTransitionSchema.nullable().default(null),
    expectedRevision: z.number().int().min(0).nullable().optional(),
  }).strict(),
]);
export type RemixRequest = z.input<typeof remixRequest>;

export type RemixShot = { index: number; start: number; end: number; duration: number };
/** The edit grammar a remix keeps: when the reference cuts, its pace and whether it has sound. */
export type RemixGrammar = { duration: number; shots: RemixShot[]; averageShot: number; cutsPerMinute: number };
export type RemixView = {
  requestId: string; runId: string; createdAt: number;
  sourceAssetId: string; sourceUrl: string | null; sourceName: string | null;
  state: string; error: string | null; grammar: RemixGrammar | null;
};
export type RemixMaterial = { assetId: string; kind: 'image' | 'video'; duration: number | null; name: string };
export type RemixAssignment = { shot: RemixShot; material: RemixMaterial; length: number };
