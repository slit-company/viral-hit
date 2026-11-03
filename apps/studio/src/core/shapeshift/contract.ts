import { z } from 'zod';
import type { CostTotal } from '../costs/pricing';
import { FACE_MATCH_THRESHOLD } from '../characters/face-match';
import type { SwapVerdict } from '../character-swap/contract';
import { MAX_SUBJECT_IMAGES, MAX_VARIATIONS, SHAPESHIFT_MODES, SHAPESHIFT_QUALITIES, SHAPESHIFT_STYLES, type ShapeshiftMode, type ShapeshiftQuality, type ShapeshiftStyle } from './options';

export { MAX_SUBJECT_IMAGES, MAX_VARIATIONS, SHAPESHIFT_MODES, SHAPESHIFT_QUALITIES, SHAPESHIFT_STYLES, type ShapeshiftMode, type ShapeshiftQuality, type ShapeshiftStyle };

/**
 * Shapeshift rebuilds part of an existing video while its motion, timing, camera and sound stay as shot,
 * on other services' video models. Motion transfer keeps only the movement and builds a new scene around
 * the character; object swap replaces exactly one subject and leaves the rest of the shot.
 */
export const SHAPESHIFT_PREFIX = 'shapeshift:';
/** Source videos from 2 seconds to 2 minutes; longer than a model makes in one go are cut into even pieces. */
export const SOURCE_SECONDS = { min: 2, max: 120 } as const;
export const MAX_GENERATIONS = 12, MIN_PIECE_SECONDS = 2;

const id = z.string().min(1).max(128);
const mode = z.enum(SHAPESHIFT_MODES);
const target = {
  mode,
  sourceAssetId: id,
  /** A range of the source in seconds; the whole video when omitted. */
  start: z.number().min(0).max(3600).optional(),
  end: z.number().min(0).max(3600).optional(),
  /** Pictures of the character, product or outfit, main one first; a library character adds its own. */
  imageAssetIds: z.array(id).max(MAX_SUBJECT_IMAGES).default([]),
  characterId: id.optional(),
  style: z.enum(SHAPESHIFT_STYLES).default('none'),
  prompt: z.string().trim().max(1000).default(''),
  /** auto runs the best connected models that have credit, a different one per variation. */
  modelId: z.string().min(1).max(200).default('auto'),
  quality: z.enum(SHAPESHIFT_QUALITIES).default('720p'),
  /** Several results to compare; the best by motion and face is marked. */
  variations: z.number().int().min(1).max(MAX_VARIATIONS).default(1),
  keepSound: z.boolean().default(true),
};
const subject = (value: { imageAssetIds: string[]; characterId?: string; start?: number; end?: number }, ctx: z.RefinementCtx) => {
  if (!value.imageAssetIds.length && !value.characterId) ctx.addIssue({ code: 'custom', message: 'Add at least one picture of the subject, or choose a character' });
  if (value.start !== undefined && value.end !== undefined && value.end <= value.start) ctx.addIssue({ code: 'custom', message: 'The end must come after the start' });
};
export const shapeshiftRequest = z.discriminatedUnion('action', [
  /** Models that can run a mode, best first, with their credit state; spends nothing. */
  z.object({ action: z.literal('models'), mode }).strict(),
  /** Models, pieces, prompts and estimate without spending anything. */
  z.object({ action: z.literal('plan'), ...target }).strict().superRefine(subject),
  /** Cuts the pieces and queues every generation as one durable run (paid). */
  z.object({ action: z.literal('produce'), requestId: z.string().uuid(), ...target }).strict().superRefine(subject),
  z.object({ action: z.literal('list') }).strict(),
  /** Local: joins finished pieces into one video with the source's length, framing and sound, then scores motion and face. */
  z.object({ action: z.literal('finish'), requestId: z.string().uuid() }).strict(),
]);
export type ShapeshiftRequest = z.input<typeof shapeshiftRequest>;

export type ShapeshiftCandidate = { id: string; name: string; providerLabel: string; credit: 'ok' | 'empty' | 'unknown'; recommended: boolean };
export type ShapeshiftPiece = { start: number; duration: number };
export type ShapeshiftTakePlan = { modelId: string; modelName: string; providerLabel: string; prompt: string; imageAssetIds: string[]; pieces: ShapeshiftPiece[]; cost: CostTotal };
export type ShapeshiftNote =
  | { kind: 'images-trimmed'; modelName: string; used: number; given: number }
  | { kind: 'skipped'; services: string[] }
  | { kind: 'repeated'; modelName: string };
export type ShapeshiftPlan = { mode: ShapeshiftMode; start: number; duration: number; takes: ShapeshiftTakePlan[]; cost: CostTotal; notes: ShapeshiftNote[] };
export type ShapeshiftScores = { motion: number | null; character: number | null; source: number | null; verdict: SwapVerdict | null; score: number };
export type ShapeshiftVariation = {
  index: number; modelId: string; modelName: string; providerLabel: string;
  pieces: { index: number; start: number; duration: number; state: string; error: string | null; outputAssetId: string | null }[];
  resultAssetId: string | null; resultUrl: string | null; scores: ShapeshiftScores | null; best: boolean;
};
export type ShapeshiftView = {
  requestId: string; runId: string; mode: ShapeshiftMode; sourceAssetId: string; sourceUrl: string | null;
  start: number; duration: number; imageAssetIds: string[]; characterId: string | null; style: ShapeshiftStyle; prompt: string; quality: ShapeshiftQuality;
  keepSound: boolean; createdAt: number; variations: ShapeshiftVariation[];
};

const round = (value: number) => Math.round(value * 1000) / 1000;
/** Even pieces no longer than the model makes in one go, in source time. */
export function splitSource(start: number, duration: number, longest: number) {
  const count = Math.max(1, Math.ceil(duration / Math.max(MIN_PIECE_SECONDS, longest) - 1e-9)), length = duration / count;
  return Array.from({ length: count }, (_, index) => ({ start: round(start + index * length), duration: round(length) }));
}

const STYLE: Record<Exclude<ShapeshiftStyle, 'none'>, string> = {
  anime: 'a hand-drawn Japanese anime look with clean line art and cel shading',
  'animation-3d': 'a polished 3D animated feature look with soft light',
  claymation: 'a stop-motion claymation look with visible clay texture',
  comic: 'a bold comic-book look with ink outlines and halftone shading',
  watercolor: 'a soft watercolor painting look on textured paper',
  'pixel-art': 'a crisp retro pixel-art look',
  'film-noir': 'a high-contrast black-and-white film noir look',
  neon: 'a neon-lit cyberpunk look with magenta and cyan glow',
  'oil-painting': 'a rich oil-painting look with visible brush strokes',
};

/** Says which input supplies what; models that take a reference video follow these assignments closely. */
export function shapeshiftPrompt(mode: ShapeshiftMode, style: ShapeshiftStyle, notes: string, images: number) {
  const pictures = images > 1 ? 'the reference images' : 'the reference image';
  const lines = mode === 'object-swap' ? [
    'Replace the main subject of the reference video with the subject from ' + pictures + '.',
    'Take only its look from ' + pictures + ': face, hair, outfit, body shape, colours and materials.',
    'Keep everything else from the reference video: body movement, gestures, expressions, gaze, timing, camera movement, framing, background and lighting.',
  ] : [
    'Create a new video of the character from ' + pictures + ' performing exactly the motion of the reference video.',
    'Keep the body movement, gestures, timing, camera movement and framing of the reference video.',
    "Take the character's look and the setting from " + pictures + ', not from the reference video.',
  ];
  if (style !== 'none') lines.push('Render the whole video in ' + STYLE[style] + ', keeping the motion, camera and framing.');
  if (notes.trim()) lines.push(notes.trim());
  return lines.join(' ');
}

/**
 * One number to compare results: how closely the motion follows the source, and for people how much the
 * face resembles the character. A face that still resembles the original person costs points.
 */
export function shapeshiftScore({ motion, character, source }: Pick<ShapeshiftScores, 'motion' | 'character' | 'source'>) {
  const parts: number[] = [];
  if (motion !== null) parts.push(motion);
  if (character !== null) parts.push(Math.min(1, character / 0.6) - (source !== null && source >= FACE_MATCH_THRESHOLD ? 0.3 : 0));
  return parts.length ? round(parts.reduce((sum, value) => sum + value, 0) / parts.length) : 0;
}

/** The finished variation with the highest score, or -1 before any has finished. */
export function bestVariation(scores: readonly (number | null)[]) {
  let best = -1;
  scores.forEach((score, index) => { if (score !== null && (best < 0 || score > scores[best]!)) best = index; });
  return best;
}
