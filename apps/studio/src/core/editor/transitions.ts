import {
  MAX_TRANSITION_SECONDS,
  MIN_TRANSITION_SECONDS,
  timelineTransitionSchema,
  type TimelineTransition,
  type TimelineTransitionKind,
} from './transition-contract';
import type { TimelineClip, TimelineDocument } from './timeline-document';

const CUT_TOLERANCE_SECONDS = 0.002;

const isVisual = (clip: TimelineClip) => clip.sourceType === 'image' || clip.sourceType === 'video';

/** The playable length of a clip's entry transition: never longer than the clip itself. */
export function transitionSeconds(clip: Pick<TimelineClip, 'duration' | 'transition'>) {
  return clip.transition ? Math.max(0, Math.min(clip.transition.duration, clip.duration)) : 0;
}

/** The visual clip on the same track that ends exactly where `incoming` starts; null after a gap. */
export function findOutgoingClip<T extends { clip: TimelineClip }>(candidates: readonly T[], incoming: TimelineClip): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    const { clip } = candidate;
    if (clip.id === incoming.id || clip.trackId !== incoming.trackId || !isVisual(clip)) continue;
    if (Math.abs(clip.startTime + clip.duration - incoming.startTime) > CUT_TOLERANCE_SECONDS) continue;
    if (!best || clip.startTime > best.clip.startTime) best = candidate;
  }
  return best;
}

export type TimelineTransitionSpan = {
  trackId: string;
  incoming: TimelineClip;
  outgoing: TimelineClip | null;
  kind: TimelineTransitionKind;
  start: number;
  duration: number;
};

/** Transitions that render: visible base tracks, visual clips, positive playable length. */
export function listTimelineTransitions(document: TimelineDocument): TimelineTransitionSpan[] {
  const spans: TimelineTransitionSpan[] = [];
  for (const track of document.tracks) {
    if (track.kind !== 'video' || track.hidden || track.muted) continue;
    const visuals = track.clips.filter(isVisual).map((clip) => ({ clip }));
    for (const { clip } of visuals) {
      const duration = transitionSeconds(clip);
      if (!clip.transition || duration <= 0) continue;
      spans.push({
        trackId: track.id,
        incoming: clip,
        outgoing: findOutgoingClip(visuals, clip)?.clip ?? null,
        kind: clip.transition.kind,
        start: clip.startTime,
        duration,
      });
    }
  }
  return spans.sort((left, right) => left.start - right.start);
}

/** Progress of the transition entering `clip` at `time`, or null outside its window. */
export function transitionProgress(clip: TimelineClip, time: number) {
  const seconds = transitionSeconds(clip);
  const elapsed = time - clip.startTime;
  if (!clip.transition || seconds <= 0 || elapsed < 0 || elapsed >= seconds) return null;
  return elapsed / seconds;
}

const roundMs = (value: number) => Math.round(value * 1000) / 1000;

function writeTransition(document: TimelineDocument, clipId: string, transition: TimelineTransition | null) {
  const track = document.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!track || !clip || track.kind !== 'video' || track.locked || !isVisual(clip)) return document;
  let next: TimelineTransition | null = null;
  if (transition) {
    if (clip.duration < MIN_TRANSITION_SECONDS) return document;
    next = timelineTransitionSchema.parse({
      kind: transition.kind,
      duration: roundMs(Math.max(MIN_TRANSITION_SECONDS, Math.min(transition.duration, MAX_TRANSITION_SECONDS, clip.duration))),
    });
  }
  const clips = track.clips.map((candidate) => {
    if (candidate.id !== clipId) return candidate;
    const { transition: _previous, ...rest } = candidate;
    return next ? { ...rest, transition: next } : rest;
  });
  return {
    ...document,
    updatedAt: new Date().toISOString(),
    tracks: document.tracks.map((candidate) => (candidate.id === track.id ? { ...candidate, clips } : candidate)),
  };
}

/** Set or clear how one base-track visual clip enters. Locked tracks and non-visual clips are unchanged. */
export function setTimelineTransition(document: TimelineDocument, clipId: string, transition: TimelineTransition | null) {
  return writeTransition(document, clipId, transition);
}

/** Apply one transition to every cut between adjacent visual clips, or clear every base-track transition. */
export function setTimelineTransitionsAtCuts(document: TimelineDocument, transition: TimelineTransition | null) {
  let next = document;
  for (const track of document.tracks) {
    if (track.kind !== 'video' || track.locked) continue;
    const visuals = track.clips.filter(isVisual).map((clip) => ({ clip }));
    for (const { clip } of visuals) {
      if (transition === null || findOutgoingClip(visuals, clip)) next = writeTransition(next, clip.id, transition);
    }
  }
  return next;
}
