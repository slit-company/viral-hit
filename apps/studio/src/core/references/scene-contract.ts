import { z } from 'zod';
import { sampleReferenceInput } from './recipe-contract';

export const SCENE_MAX_BYTES = 64 * 1024 * 1024;
export const SCENE_MAX_SECONDS = 600;
export const sceneInput = sampleReferenceInput.extend({
  threshold: z.number().finite().min(1).max(100).default(10),
  minDuration: z.number().finite().min(.125).max(30).default(.5),
  maxScenes: z.number().int().min(1).max(64).default(24),
  engine: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export const sceneAnalysis = z.object({
  algorithm: z.literal('ffmpeg-scdet-v1'), sampleFps: z.literal(8),
  threshold: z.number().min(1).max(100), minDuration: z.number().min(.125).max(30), maxScenes: z.number().int().min(1).max(64),
  duration: z.number().finite().min(.01).max(SCENE_MAX_SECONDS),
  candidateCount: z.number().int().min(0).max(4800),
  scenes: z.array(z.object({ start: z.number().finite().min(0), end: z.number().finite().positive(), score: z.number().finite().min(0).max(100) }).strict()).min(1).max(64),
}).strict().superRefine((value, ctx) => {
  if (value.scenes.length > value.maxScenes || value.scenes.length - 1 > value.candidateCount || value.scenes[0].start !== 0 || value.scenes.at(-1)!.end !== value.duration) ctx.addIssue({ code: 'custom', message: 'Scene coverage is incomplete' });
  for (const [index, scene] of value.scenes.entries()) if (scene.end <= scene.start || scene.end > value.duration || (index > 0 && scene.start !== value.scenes[index - 1].end)) ctx.addIssue({ code: 'custom', message: 'Scene ranges overlap or contain gaps' });
});
export type SceneAnalysis = z.infer<typeof sceneAnalysis>;
export const sceneReceipt = z.object({
  projectId: z.string().min(1), assetId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(SCENE_MAX_BYTES), kind: z.literal('video'),
  publicUrl: z.string().max(1000), width: z.number().int().positive(), height: z.number().int().positive(), durationMs: z.number().int().positive().max(SCENE_MAX_SECONDS * 1000),
  mediaMaterialized: z.literal(true), analysis: sceneAnalysis,
}).strict().refine(value => value.durationMs / 1000 === value.analysis.duration, 'Scene duration differs from its media');
export function readSceneOutput(raw: string | null) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    // Executable track bindings are intentionally not a browser preview contract.
    const { tracks: _, ...receipt } = value;
    const result = sceneReceipt.safeParse(receipt); return result.success ? result.data : null;
  } catch { return null; }
}

/** Prefer strong transitions while preserving the full source interval and minimum spacing. */
export function chooseSceneRanges(candidates: { time: number; score: number }[], duration: number, minDuration: number, maxScenes: number) {
  const selected: { time: number; score: number }[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score || a.time - b.time)) {
    if (selected.length >= maxScenes - 1) break;
    if (candidate.time < minDuration || duration - candidate.time < minDuration || selected.some(other => Math.abs(other.time - candidate.time) < minDuration)) continue;
    selected.push(candidate);
  }
  const starts = [{ time: 0, score: 0 }, ...selected.sort((a, b) => a.time - b.time)];
  return starts.map((point, index) => ({ start: point.time, end: starts[index + 1]?.time ?? duration, score: point.score }));
}
