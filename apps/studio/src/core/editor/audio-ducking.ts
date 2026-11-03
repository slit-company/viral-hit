import { z } from 'zod';

type MixTrack = { muted: boolean; kind: string; clips: readonly { audioRole?: string; muted: boolean; volume: number; startTime: number; duration: number }[] };

/**
 * Ducking lowers a music or sound clip while a voice clip plays. level is the gain kept under the voice
 * (0.25 ≈ −12 dB); attack and release are the seconds the level takes to go down before the voice and back after it.
 * The same piecewise-linear envelope drives the preview, the browser export and the FFmpeg export.
 */
export const audioDuckingSchema = z.object({
  level: z.number().finite().min(0).max(0.95),
  attack: z.number().finite().min(0.05).max(2),
  release: z.number().finite().min(0.05).max(3),
}).strict();
export type AudioDucking = z.infer<typeof audioDuckingSchema>;
export const DEFAULT_DUCKING: AudioDucking = { level: 0.25, attack: 0.25, release: 0.5 };
/** Gain kept under a voice for each choice in the editor: about −6, −12 and −18 dB. */
export const DUCKING_LEVELS = [0.5, 0.25, 0.125] as const;

export const normalizeDucking = (value: Partial<AudioDucking> & { level: number }): AudioDucking =>
  audioDuckingSchema.parse({ ...DEFAULT_DUCKING, ...value });

/** Seconds where a voice clip is audible, merged where the music would not have time to come back up. */
export function voiceIntervals(document: { tracks: readonly MixTrack[] }, ducking: AudioDucking = DEFAULT_DUCKING) {
  const spans: [number, number][] = [];
  for (const track of document.tracks) {
    if (track.muted || track.kind === 'caption') continue;
    for (const clip of track.clips) if (clip.audioRole === 'voice' && !clip.muted && clip.volume > 0) spans.push([clip.startTime, clip.startTime + clip.duration]);
  }
  spans.sort((left, right) => left[0] - right[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of spans) {
    const last = merged.at(-1);
    if (last && start - last[1] <= ducking.attack + ducking.release) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Gain multiplier (at most 1) for a ducked clip at a timeline time. */
export function duckingGain(intervals: readonly (readonly [number, number])[], ducking: AudioDucking, time: number) {
  let envelope = 0;
  for (const [start, end] of intervals) {
    if (time < start - ducking.attack || time > end + ducking.release) continue;
    envelope = Math.max(envelope, time < start ? 1 - (start - time) / ducking.attack : time > end ? 1 - (time - end) / ducking.release : 1);
    if (envelope >= 1) break;
  }
  return 1 - (1 - ducking.level) * envelope;
}

const n = (value: number) => Number(value.toFixed(4)).toString();
/**
 * The same envelope as an FFmpeg volume expression in clip seconds (t = 0 at the clip's first sample),
 * or null when no voice reaches the clip. At most 64 voice spans are written.
 */
export function duckingExpression(intervals: readonly (readonly [number, number])[], ducking: AudioDucking, clipStart: number, clipDuration: number) {
  const near = intervals.filter(([start, end]) => end + ducking.release > clipStart && start - ducking.attack < clipStart + clipDuration).slice(0, 64);
  if (!near.length) return null;
  const ramps = near.map(([start, end]) => `clip(min((t-(${n(start - ducking.attack - clipStart)}))/${n(ducking.attack)},(${n(end + ducking.release - clipStart)}-t)/${n(ducking.release)}),0,1)`);
  return `1-${n(1 - ducking.level)}*${ramps.reduce((all, ramp) => `max(${all},${ramp})`)}`;
}
