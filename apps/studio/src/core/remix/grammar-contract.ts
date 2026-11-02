import { z } from 'zod';
import { sampleReferenceInput } from '../references/recipe-contract';

export const GRAMMAR_MAX_SECONDS = 600;
export const GRAMMAR_MAX_BYTES = 64 * 1024 * 1024;
/** Camera motion and on-screen text of a reference, read locally. text: false skips reading text. */
export const grammarInput = sampleReferenceInput.extend({
  text: z.boolean().default(true),
  engine: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
const fraction = z.number().finite().min(0).max(1), time = z.number().finite().min(0).max(GRAMMAR_MAX_SECONDS);
const series = z.array(z.number().finite().min(-1000).max(1000)).max(2400);
export const grammarAnalysis = z.object({
  algorithm: z.literal('viral-hit-grammar-v1'), duration: z.number().finite().positive().max(GRAMMAR_MAX_SECONDS),
  /** Sample i compares frames i and i+1 of a gray width × height grid at fps. */
  motion: z.object({ fps: z.union([z.literal(2), z.literal(4), z.literal(8)]), width: z.number().int().min(24).max(256), height: z.number().int().min(24).max(256), dx: series, dy: series, zoom: series, diff: series }).strict(),
  text: z.object({
    engine: z.literal('tesseract').nullable(), languages: z.array(z.string().regex(/^[a-z_]{3,10}$/)).max(8), interval: z.number().finite().positive().max(60),
    segments: z.array(z.object({ start: time, end: time, text: z.string().min(1).max(500), confidence: z.number().min(0).max(100), lines: z.number().int().min(1).max(50),
      box: z.object({ x: fraction, y: fraction, width: fraction, height: fraction }).strict() }).strict()).max(200),
  }).strict(),
}).strict().refine(value => [value.motion.dy, value.motion.zoom, value.motion.diff].every(item => item.length === value.motion.dx.length), 'Motion series differ in length');
export type GrammarAnalysis = z.infer<typeof grammarAnalysis>;
export const grammarReceipt = z.object({
  projectId: z.string().min(1), assetId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(GRAMMAR_MAX_BYTES), kind: z.literal('video'), analysis: grammarAnalysis,
}).strict();
export function readGrammarOutput(raw: string | null) {
  if (!raw) return null;
  try { const result = grammarReceipt.safeParse(JSON.parse(raw)); return result.success ? result.data : null; } catch { return null; }
}
