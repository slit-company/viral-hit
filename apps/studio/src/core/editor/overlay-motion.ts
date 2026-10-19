import { z } from 'zod';
import type { TimelineClip, TimelineOverlayTransform } from './timeline-document';

export const overlayTransformSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(0.05).max(2),
  opacity: z.number().finite().min(0).max(1),
  rotation: z.number().finite().min(-180).max(180),
}).strict();
export const overlayMotionSchema = z.object({
  version: z.literal(1),
  keyframes: z.array(overlayTransformSchema.extend({
    id: z.string().min(1).max(160),
    /** Source-relative seconds: splitting and trimming crop, never retime. */
    time: z.number().finite().min(0).max(86_400),
    easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']),
  }).strict()).min(1).max(32),
}).strict().superRefine((motion, ctx) => {
  const ids = new Set<string>();
  for (const [index, frame] of motion.keyframes.entries()) {
    if (ids.has(frame.id) || (index > 0 && frame.time <= motion.keyframes[index - 1].time)) {
      ctx.addIssue({ code: 'custom', message: 'Keyframes need unique IDs and strictly increasing times.' });
    }
    ids.add(frame.id);
  }
});
export type OverlayMotion = z.infer<typeof overlayMotionSchema>;
export type OverlayKeyframe = OverlayMotion['keyframes'][number];
export const overlayFields = ['x', 'y', 'width', 'opacity', 'rotation'] as const;

export function easeOverlay(progress: number, easing: OverlayKeyframe['easing']) {
  const t = Math.min(1, Math.max(0, progress));
  if (easing === 'ease-in') return t * t;
  if (easing === 'ease-out') return 1 - (1 - t) * (1 - t);
  if (easing === 'ease-in-out') return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  return t;
}

export function overlayTransformAt(clip: Pick<TimelineClip, 'overlay' | 'motion' | 'startTime' | 'inPoint'>, timelineTime: number): TimelineOverlayTransform | null {
  if (!clip.overlay || !clip.motion) return clip.overlay;
  const frames = clip.motion.keyframes;
  const time = clip.inPoint + timelineTime - clip.startTime;
  const right = frames.findIndex(frame => frame.time > time);
  const a = frames[right <= 0 ? (right === 0 ? 0 : frames.length - 1) : right - 1];
  const b = right > 0 ? frames[right] : a;
  const progress = a === b ? 0 : easeOverlay((time - a.time) / (b.time - a.time), a.easing);
  return Object.fromEntries(overlayFields.map(field => [field, a[field] + (b[field] - a[field]) * progress])) as TimelineOverlayTransform;
}

export function withOverlayKeyframe(clip: TimelineClip, timelineTime: number, patch: Partial<TimelineOverlayTransform> = {}): OverlayMotion {
  if (!clip.overlay || !Number.isFinite(timelineTime)) throw Error('A keyframe needs an overlay and a finite timeline time.');
  const time = Math.round(Math.max(clip.inPoint, Math.min(clip.outPoint, clip.inPoint + timelineTime - clip.startTime)) * 1000) / 1000;
  const frames = clip.motion?.keyframes ?? [];
  const existing = frames.find(frame => Math.abs(frame.time - time) < 0.0005);
  const pose = overlayTransformAt(clip, clip.startTime + time - clip.inPoint)!;
  const keyframe = { ...pose, ...patch, id: existing?.id ?? `key-${crypto.randomUUID()}`, time, easing: existing?.easing ?? 'linear' as const };
  return overlayMotionSchema.parse({ version: 1, keyframes: [...frames.filter(frame => frame !== existing), keyframe].sort((a, b) => a.time - b.time) });
}

export type OverlayPatch = Partial<TimelineOverlayTransform> & { fadeIn?: number; fadeOut?: number };
export function patchOverlayClip(clip: TimelineClip, patch: OverlayPatch, atTime?: number): TimelineClip {
  if (!clip.overlay) return clip;
  const transform = { ...clip.overlay };
  const limits = { x: [0, 1], y: [0, 1], width: [0.05, 2], opacity: [0, 1], rotation: [-180, 180] };
  const changed: Partial<TimelineOverlayTransform> = {};
  for (const field of overlayFields) {
    const value = patch[field];
    if (value === undefined) continue;
    if (!Number.isFinite(value)) throw Error('Overlay values must be finite.');
    changed[field] = Math.max(limits[field][0], Math.min(limits[field][1], value));
    transform[field] = changed[field]!;
  }
  const hasPose = Object.keys(changed).length > 0;
  if (clip.motion && hasPose && atTime === undefined) throw Error('Animated overlay updates require atTime.');
  return { ...clip,
    overlay: clip.motion ? clip.overlay : transform,
    ...(clip.motion && hasPose ? { motion: withOverlayKeyframe(clip, atTime!, changed) } : {}),
    fadeIn: patch.fadeIn === undefined ? clip.fadeIn : Math.max(0, Math.min(clip.duration, patch.fadeIn)),
    fadeOut: patch.fadeOut === undefined ? clip.fadeOut : Math.max(0, Math.min(clip.duration, patch.fadeOut)),
  };
}

export function canEditOverlayPose(clip: TimelineClip, timelineTime: number) {
  if (!clip.motion || clip.motion.keyframes.length < 32) return true;
  const time = Math.round(Math.max(clip.inPoint, Math.min(clip.outPoint, clip.inPoint + timelineTime - clip.startTime)) * 1000) / 1000;
  return clip.motion.keyframes.some(frame => Math.abs(frame.time - time) < 0.0005);
}
