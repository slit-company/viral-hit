import { z } from 'zod';
import { timelineTransitionSchema } from '../editor/transition-contract';
import type { CameraMove, SpeedSignals } from './motion';
import type { TextBox } from './onscreen-text';

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
    /** Also read on-screen text (local OCR when Tesseract is installed). Camera motion is always read. */
    readText: z.boolean().default(true),
  }).strict(),
  /** Rebuild the reference's cut rhythm with new material at the end of the timeline. */
  z.object({
    action: z.literal('build'), requestId: z.string().uuid(),
    materials: z.array(assetId).min(1).max(64),
    keepSoundtrack: z.boolean().default(true),
    transition: timelineTransitionSchema.nullable().default(null),
    /** Give still images the reference shot's zoom, pan or tilt. */
    keepCamera: z.boolean().default(true),
    /** Copy the reference's on-screen text as editable captions at the same times and heights. */
    keepText: z.boolean().default(false),
    /** Repeat a shot's speed-up or slow-down on video material: the second half of the shot plays at 2× or 0.5×. */
    keepSpeed: z.boolean().default(true),
    expectedRevision: z.number().int().min(0).nullable().optional(),
  }).strict(),
]);
export type RemixRequest = z.input<typeof remixRequest>;

/** camera, speed and text exist once the reference's edit analysis has finished. */
export type RemixShot = { index: number; start: number; end: number; duration: number; camera?: CameraMove; speed?: SpeedSignals; text?: string[] };
export type RemixText = { start: number; end: number; text: string; box: TextBox; lines: number };
/** The edit grammar a remix keeps: when the reference cuts, its pace, its camera moves and its on-screen text. */
export type RemixGrammar = {
  duration: number; shots: RemixShot[]; averageShot: number; cutsPerMinute: number;
  edit?: { text: 'read' | 'unavailable' | 'off'; texts: RemixText[]; frame: { width: number; height: number } };
};
export type RemixView = {
  requestId: string; runId: string; createdAt: number;
  sourceAssetId: string; sourceUrl: string | null; sourceName: string | null;
  state: string; error: string | null; grammar: RemixGrammar | null;
  /** Camera and text analysis; null for remixes analysed before it existed. */
  edit: { state: string; error: string | null } | null;
};
export type RemixMaterial = { assetId: string; kind: 'image' | 'video'; duration: number | null; name: string };
export type RemixAssignment = { shot: RemixShot; material: RemixMaterial; length: number };
