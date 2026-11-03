import { z } from 'zod';
import { FACE_MATCH_THRESHOLD } from '../characters/face-match';
import type { CostTotal } from '../costs/pricing';

/**
 * Character swap: the person in a timeline clip becomes a character, keeping the clip's movement,
 * expressions, timing, camera and scene. Reference-to-video models (MiniMax H3 R2V first) regenerate
 * the frames from the clip and the character's images; local face matching checks the result.
 */
export const SWAP_REQUEST_PREFIX = 'character-swap:';
/** Reference videos for these models run 2 to 15 seconds each. */
export const MAX_SWAP_SECONDS = 15, MIN_SWAP_SECONDS = 2, MAX_SWAP_SEGMENTS = 8;
const id = z.string().min(1).max(128);
const target = {
  clipId: id, modelId: z.string().min(1).max(200),
  /** A library character, or project images of the character (up to 9). */
  characterId: id.optional(), imageAssetIds: z.array(id).min(1).max(9).optional(),
  notes: z.string().trim().max(600).default(''),
  /** Keep the clip's original sound under the swapped picture. */
  keepSound: z.boolean().default(true),
};
export const characterSwapRequest = z.discriminatedUnion('action', [
  /** Pieces, prompt and estimate without spending anything. */
  z.object({ action: z.literal('plan'), ...target }).strict(),
  /** Cuts the pieces and queues one generation per piece as a durable run (paid). */
  z.object({ action: z.literal('produce'), requestId: z.string().uuid(), ...target }).strict(),
  z.object({ action: z.literal('list'), clipId: id.optional() }).strict(),
  /** Local and free: compares each result's faces with the character and with the original person. */
  z.object({ action: z.literal('evaluate'), requestId: z.string().uuid() }).strict(),
  /** Puts the results on the clip as takes; the original stays one click away. */
  z.object({ action: z.literal('place'), requestId: z.string().uuid() }).strict(),
]);
export type CharacterSwapRequest = z.input<typeof characterSwapRequest>;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Even pieces of at most maxSeconds (15 by default), each at least 2, in source time. */
export function swapSegments(start: number, duration: number, maxSeconds = MAX_SWAP_SECONDS) {
  if (!(duration >= MIN_SWAP_SECONDS)) throw Error('Choose a clip of at least ' + MIN_SWAP_SECONDS + ' seconds');
  const longest = Math.max(MIN_SWAP_SECONDS, Math.min(MAX_SWAP_SECONDS, maxSeconds));
  const count = Math.ceil(duration / longest - 1e-9);
  if (count > MAX_SWAP_SEGMENTS) throw Error('Swap at most ' + longest * MAX_SWAP_SEGMENTS + ' seconds at once');
  const length = duration / count;
  return Array.from({ length: count }, (_, index) => ({ start: round(start + index * length), duration: round(length) }));
}

/** The output length to ask for: the shortest supported length that covers the piece. */
export function swapDuration(seconds: number, durations?: readonly string[] | null) {
  const supported = (durations ?? []).map(value => Number.parseInt(value, 10)).filter(Number.isFinite).sort((left, right) => left - right);
  if (!supported.length) return null;
  return (supported.find(value => value >= seconds - 0.05) ?? supported[supported.length - 1]) + 's';
}

/** Says which input supplies what; reference-to-video models follow these assignments closely. */
export function characterSwapPrompt(notes: string, images: number) {
  const pictures = images > 1 ? 'the reference images' : 'the reference image';
  return [
    'Replace the person in the reference video with the character from ' + pictures + '.',
    'Take only the face, hair, outfit and body shape from ' + pictures + '.',
    'Keep everything else from the reference video: body movement, head turns, facial expressions, gaze, acting timing, camera movement, framing, background and lighting.',
    notes.trim(),
  ].filter(Boolean).join(' ');
}

export type SwapVerdict = 'swapped' | 'blended' | 'kept' | 'unclear';
/**
 * From the median face similarity of a result to the character and to the original person:
 * blended means it resembles both, the identity mix reference-to-video tests often show.
 */
export function swapVerdict(character: number | null, source: number | null, threshold = FACE_MATCH_THRESHOLD): SwapVerdict {
  const isCharacter = character !== null && character >= threshold, isSource = source !== null && source >= threshold;
  return isCharacter ? (isSource ? 'blended' : 'swapped') : isSource ? 'kept' : 'unclear';
}

export type SwapEvaluation = { verdict: SwapVerdict; character: number | null; source: number | null; facedFrames: number };
export type CharacterSwapPiece = {
  index: number; start: number; duration: number; sourceAssetId: string;
  state: string; error: string | null; outputAssetId: string | null; outputUrl: string | null; evaluation: SwapEvaluation | null;
};
export type CharacterSwapView = {
  requestId: string; runId: string; clipId: string; modelId: string; characterId: string | null; imageAssetIds: string[];
  keepSound: boolean; prompt: string; createdAt: number; placedAt: number | null; pieces: CharacterSwapPiece[];
};
export type CharacterSwapPlan = { clipId: string; modelId: string; prompt: string; imageAssetIds: string[]; pieces: { start: number; duration: number; outputDuration: string | null }[]; cost: CostTotal };
