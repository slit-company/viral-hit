import { overlayMotionSchema } from './overlay-motion';
import { z } from 'zod';
import { createTimelineDocument, normalizeTimelineDocument, type TimelineDocument, type TimelineClip } from './timeline-document';
import { diagnoseTimeline } from './timeline-diagnostics';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).refine(value => !['constructor', 'prototype'].includes(value));
const time = z.number().finite().min(0).max(3600);
const duration = z.number().finite().min(0.01).max(3600);
const common = { id, startTime: time, duration };
const overlay = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0.05).max(2), opacity: z.number().min(0).max(1), rotation: z.number().min(-180).max(180) }).strict();
const caption = z.object({ fontScale: z.number().min(0.015).max(0.12), maxWidth: z.number().min(0.25).max(0.98), bottomOffset: z.number().min(0.02).max(0.9) }).strict();
const clip = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('media'), source: id, inPoint: time.default(0), volume: z.number().min(0).max(4).default(1), muted: z.boolean().default(false), fadeIn: time.default(0), fadeOut: time.default(0), audioRole: z.enum(['music', 'voice', 'sfx', 'source']).optional(), overlay: overlay.optional(), motion: overlayMotionSchema.optional() }).strict(),
  z.object({ ...common, type: z.literal('caption'), text: z.string().trim().min(1).max(4000), caption: caption.optional() }).strict(),
]);
/** Portable edit intent: project asset IDs, never paths, URLs, code or whole-document replacement. */
export const sequenceSchema = z.object({
  schemaVersion: z.literal(1), title: z.string().trim().min(1).max(120),
  assets: z.record(id, z.object({ assetId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), kind: z.enum(['image', 'video', 'audio']) }).strict()).refine(value => Object.keys(value).length <= 16),
  tracks: z.array(z.object({ id, kind: z.enum(['video', 'overlay', 'audio', 'caption']), name: z.string().trim().min(1).max(80), clips: z.array(clip).max(128) }).strict()).min(1).max(16),
}).strict().superRefine((sequence, ctx) => {
  const ids = new Set<string>(); let count = 0;
  for (const track of sequence.tracks) {
    if (!track.clips.length && track.kind !== 'caption') ctx.addIssue({ code: 'custom', message: 'Only a caption track may be empty' });
    if (ids.has(`track:${track.id}`)) ctx.addIssue({ code: 'custom', message: 'Duplicate sequence track ID' });
    ids.add(`track:${track.id}`);
    for (const clip of track.clips) {
      count++;
      if (ids.has(`clip:${clip.id}`)) ctx.addIssue({ code: 'custom', message: 'Duplicate sequence clip ID' });
      ids.add(`clip:${clip.id}`);
      if (clip.startTime + clip.duration > 3600) ctx.addIssue({ code: 'custom', message: 'Sequence exceeds one hour' });
      if (clip.type === 'caption') {
        if (track.kind !== 'caption') ctx.addIssue({ code: 'custom', message: 'Caption needs a caption track' });
        continue;
      }
      const source = sequence.assets[clip.source];
      if (!source || (track.kind === 'audio' ? source.kind !== 'audio' : track.kind === 'overlay' ? source.kind === 'audio' : track.kind === 'video' ? source.kind === 'audio' : true)) ctx.addIssue({ code: 'custom', message: 'Media kind does not match the sequence track' });
      if ((clip.overlay || clip.motion) && track.kind !== 'overlay') ctx.addIssue({ code: 'custom', message: 'Overlay transform needs an overlay track' });
      if (source?.kind === 'image' && clip.inPoint !== 0) ctx.addIssue({ code: 'custom', message: 'Images have no source in-point' });
      if (clip.fadeIn > clip.duration || clip.fadeOut > clip.duration) ctx.addIssue({ code: 'custom', message: 'Fade exceeds clip duration' });
    }
  }
  if (count > 128) ctx.addIssue({ code: 'custom', message: 'Sequence exceeds 128 clips' });
});
export type EditableSequence = z.infer<typeof sequenceSchema>;
export type SequenceMedia = { assetId: string; kind: 'image' | 'video' | 'audio'; publicUrl: string; name: string; duration: number | null };

export function appendSequence(source: TimelineDocument, sequence: EditableSequence, media: Record<string, SequenceMedia>, prefix: string) {
  const offset = source.duration;
  const tracks = sequence.tracks.map(track => {
    const trackId = `${prefix}-${track.id}`;
    const clips: TimelineClip[] = track.clips.map(clip => {
      const clipId = `${prefix}-${clip.id}`;
      const base = { id: clipId, trackId, startTime: offset + clip.startTime, duration: clip.duration, takes: [], activeTakeId: null, caption: null, overlay: null };
      if (clip.type === 'caption') return { ...base, assetId: clipId, sourceUrl: '', name: clip.text.slice(0, 80), sourceType: 'caption', text: clip.text, inPoint: 0, outPoint: clip.duration, sourceDuration: clip.duration, volume: 1, muted: false, fadeIn: 0, fadeOut: 0, caption: clip.caption ?? null };
      const asset = media[clip.source];
      if (!asset || asset.assetId !== sequence.assets[clip.source].assetId || asset.kind !== sequence.assets[clip.source].kind) throw Error('Sequence media identity mismatch');
      const sourceDuration = asset.kind === 'image' ? clip.duration : asset.duration;
      if (!sourceDuration || clip.inPoint + clip.duration > sourceDuration) throw Error(`Sequence clip ${clip.id} exceeds its source duration`);
      return { ...base, assetId: asset.assetId, sourceUrl: asset.publicUrl, name: asset.name, sourceType: asset.kind,
        sourceDuration, inPoint: clip.inPoint, outPoint: clip.inPoint + clip.duration, volume: clip.volume, muted: clip.muted,
        fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, audioRole: clip.audioRole, ...(clip.motion ? { motion: clip.motion } : {}),
        overlay: track.kind === 'overlay' ? clip.overlay ?? { x: 0.5, y: 0.25, width: 0.7, opacity: 1, rotation: 0 } : null };
    });
    return { id: trackId, kind: track.kind, name: `${sequence.title} · ${track.name}`.slice(0, 120), locked: false, hidden: false, muted: false, clips };
  });
  const existingIds = new Set(source.tracks.flatMap(track => [track.id, ...track.clips.map(clip => clip.id)]));
  if (tracks.some(track => existingIds.has(track.id) || track.clips.some(clip => existingIds.has(clip.id)))) throw Error('This sequence is already present in the timeline');
  const remaining = [...tracks];
  const existing = source.tracks.map(track => {
    if (track.clips.length || track.locked || track.hidden || track.muted) return track;
    const index = remaining.findIndex(candidate => candidate.kind === track.kind);
    if (index < 0) return track;
    const [incoming] = remaining.splice(index, 1);
    return { ...track, clips: incoming.clips.map(clip => ({ ...clip, trackId: track.id })) };
  });
  return normalizeTimelineDocument({ ...source, updatedAt: new Date().toISOString(), lastRenderAssetId: null, lastRenderUrl: null, tracks: [...existing, ...remaining] });
}

export function inspectSequence(sequence: EditableSequence, media: Record<string, SequenceMedia>, projectId: string) {
  const timeline = appendSequence(createTimelineDocument({ projectId, name: sequence.title }), sequence, media, 'inspection');
  for (const kind of ['video', 'caption']) {
    const clips = timeline.tracks.filter(track => track.kind === kind).flatMap(track => track.clips).sort((a, b) => a.startTime - b.startTime);
    if (clips.some((clip, index) => index > 0 && clip.startTime < clips[index - 1].startTime + clips[index - 1].duration - 0.001)) throw Error(`Sequence ${kind} clips overlap across tracks`);
  }
  const errors = diagnoseTimeline(timeline).filter(issue => issue.severity === 'error');
  if (errors.length) throw Error(`Sequence is not renderable: ${[...new Set(errors.map(issue => issue.code))].join(', ')}`);
  if (!timeline.tracks.some(track => track.kind === 'video' && track.clips.length)) throw Error('Sequence needs a visual track');
  return { title: sequence.title, duration: timeline.duration, trackCount: sequence.tracks.length, clipCount: sequence.tracks.reduce((count, track) => count + track.clips.length, 0) };
}
