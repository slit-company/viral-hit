import { z } from 'zod';
import { shotGroups } from '../creative-canvas/shot-line';
import { CAMERA_MOVE_IDS } from './camera-moves';
import type { VideoImageInputs } from '../generation-providers/video-image-inputs';
import type { ServiceCredit } from './health';

const ids = <T extends readonly { id: string }[]>(items: T) => items.map(item => item.id) as [T[number]['id'], ...T[number]['id'][]];
const assetId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const SHOT_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;

/** One shot as a director describes it; models and prompts are derived from it. */
export const shotSpec = z.object({
  subject: z.string().trim().min(1).max(600),
  action: z.string().trim().max(800).default(''),
  setting: z.string().trim().max(600).default(''),
  moves: z.array(z.enum(CAMERA_MOVE_IDS)).max(2).default([]),
  framing: z.enum(ids(shotGroups.size)).optional(),
  angle: z.enum(ids(shotGroups.angle)).optional(),
  lens: z.enum(ids(shotGroups.lens)).optional(),
  light: z.enum(ids(shotGroups.light)).optional(),
  look: z.enum(ids(shotGroups.look)).optional(),
  mood: z.string().trim().max(200).default(''),
  /** Sound or quoted dialogue for models that generate audio; empty keeps the shot silent. */
  audio: z.string().trim().max(600).default(''),
  duration: z.number().min(2).max(30).default(5),
  aspectRatio: z.enum(SHOT_ASPECT_RATIOS).default('16:9'),
  /** Generate a still first and animate it, or go straight to video. */
  startFrame: z.enum(['generate', 'none']).default('generate'),
  startAssetId: assetId.optional(),
  endAssetId: assetId.optional(),
  characterAssetIds: z.array(assetId).max(4).default([]),
  videoModel: z.string().min(1).max(200).default('auto'),
  imageModel: z.string().min(1).max(200).default('auto'),
  /** Keep both steps on one connected service (for example the account with credits); "any" lets routing choose. */
  provider: z.string().min(1).max(100).default('any'),
  variations: z.number().int().min(1).max(4).default(2),
}).strict().superRefine((spec, ctx) => {
  if (spec.endAssetId && !spec.startAssetId && spec.startFrame !== 'generate') ctx.addIssue({ code: 'custom', path: ['endAssetId'], message: 'Choose or generate a start frame before setting the end frame' });
  if (spec.endAssetId && spec.endAssetId === spec.startAssetId) ctx.addIssue({ code: 'custom', path: ['endAssetId'], message: 'Choose a different end frame' });
});
export type ShotSpec = z.infer<typeof shotSpec>;
export type ShotSpecInput = z.input<typeof shotSpec>;

/** The catalog facts the harness needs about a model, as the Studio catalog reports them. */
export type ShotModel = {
  id: string; name: string; providerId?: string; providerLabel?: string;
  kind: 'image' | 'video';
  studioTasks: string[];
  videoImageInputs?: VideoImageInputs;
  referenceInputs?: { image: { min: number; max: number }; video: { min: number; max: number }; audio: { min: number; max: number } };
  supportedDurations?: string[];
  supportedAspectRatios?: string[];
  controls?: Array<{ key: string; type: string; default?: unknown; choices?: Array<{ value: string | number | boolean }> }>;
  available?: boolean;
  /** Recent outcomes on this workspace's account; see health.ts. */
  health?: { score: number; reason: string };
  /** Remaining credit as the service reported it, or as the last failed run implied; see health.ts. */
  credit?: ServiceCredit;
};
