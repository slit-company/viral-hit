import { findTimelineClip, withUpdatedTracks, type TimelineClip, type TimelineDocument } from './timeline-document';

/** Speeds offered in the editor; agents may use any value from 0.25 to 4. */
export const CLIP_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
export const MIN_CLIP_SPEED = 0.25;
export const MAX_CLIP_SPEED = 4;
const round = (value: number) => Math.round(value * 1000) / 1000;

export const clipSpeed = (clip: { speed?: number }) => clip.speed ?? 1;
/** Source seconds shown at a timeline time inside a clip that starts at its source in-point. */
export const sourceTimeAt = (clip: Pick<TimelineClip, 'startTime' | 'speed'>, inPoint: number, timelineTime: number) => inPoint + (timelineTime - clip.startTime) * clipSpeed(clip);
/** Timeline seconds at which a source time of the clip plays. */
export const timelineTimeAt = (clip: Pick<TimelineClip, 'startTime' | 'speed'>, inPoint: number, sourceTime: number) => clip.startTime + (sourceTime - inPoint) / clipSpeed(clip);

/**
 * Plays a base-track video faster or slower. The clip keeps its source range, so its length changes, and the
 * clips after it on the same track move by the same amount, keeping the cut order and the gaps between them.
 * A clip at another speed plays without its own sound in the preview and both exports.
 */
export function setTimelineClipSpeed(document: TimelineDocument, clipId: string, speed: number): TimelineDocument {
  const track = document.tracks.find((candidate) => candidate.clips.some((item) => item.id === clipId));
  const clip = findTimelineClip(document, clipId);
  if (!track || !clip || track.kind !== 'video' || clip.sourceType !== 'video') throw Error('Speed applies to video clips on the base track');
  if (!Number.isFinite(speed) || speed < MIN_CLIP_SPEED || speed > MAX_CLIP_SPEED) throw Error('Choose a speed from 0.25× to 4×');
  const range = clip.activeTakeId ? Math.min(clip.takes.find((take) => take.id === clip.activeTakeId)?.sourceDuration ?? clip.duration, clip.duration * clipSpeed(clip)) : clip.outPoint - clip.inPoint;
  const duration = round(range / speed), end = clip.startTime + clip.duration, delta = duration - clip.duration;
  const { speed: _previous, ...rest } = clip;
  const next: TimelineClip = { ...rest, ...(speed === 1 ? {} : { speed: round(speed) }), duration, fadeIn: Math.min(clip.fadeIn, duration), fadeOut: Math.min(clip.fadeOut, duration) };
  return withUpdatedTracks(document, document.tracks.map((candidate) => candidate.id !== track.id ? candidate : {
    ...candidate,
    clips: candidate.clips.map((item) => item.id === clipId ? next : item.startTime >= end - 0.001 ? { ...item, startTime: round(Math.max(0, item.startTime + delta)) } : item),
  }));
}
