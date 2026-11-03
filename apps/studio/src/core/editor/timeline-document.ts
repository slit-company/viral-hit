import type { OverlaySource } from '../commands/overlay-schema';
/**
 * ViralHit's compact timeline contract is derived from OpenReel's MIT-licensed
 * Timeline / Track / Clip model. It deliberately keeps only the fields needed by
 * the local-first editing workflow so the host app owns persistence and UI.
 *
 * OpenReel source pin: 5f3c85e5fc223c86060bf4b12e1b4dec58e9b8a9
 * Copyright (c) 2024-2026 Augustus Otu and Contributors
 */

import { TIMELINE_SCHEMA_VERSION, timelineDocumentSchema } from './timeline-schema';
import { migrateLegacyTimeline } from './timeline-migration';
import type { TimelineTransition } from './transition-contract';
import { validateCaptionWords, type CaptionWord } from './caption-words';
import { overlayMotionSchema, overlayTransformAt, patchOverlayClip, type OverlayMotion, type OverlayPatch } from './overlay-motion';
import { DEFAULT_DUCKING, normalizeDucking, type AudioDucking } from './audio-ducking';

export { TIMELINE_SCHEMA_VERSION };

export type TimelineTrackKind = 'video' | 'overlay' | 'audio' | 'caption';
export type TimelineAudioRole = 'music' | 'voice' | 'sfx' | 'source';
export type CaptionStylePreset = 'classic' | 'bold' | 'boxed' | 'minimal';

export type TimelineOverlayTransform = {
  /** Horizontal center in normalized output coordinates. */
  x: number;
  /** Vertical center in normalized output coordinates. */
  y: number;
  /** Width as a fraction of the output frame width. */
  width: number;
  opacity: number;
  rotation: number;
};

export type TimelineCaptionTransform = {
  /** Font size as a fraction of the output frame height. */
  fontScale: number;
  /** Maximum text width as a fraction of the output frame width. */
  maxWidth: number;
  /** Distance from the bottom edge as a fraction of the output frame height. */
  bottomOffset: number;
};

export const DEFAULT_OVERLAY_TRANSFORM: TimelineOverlayTransform = {
  x: 0.5,
  y: 0.25,
  width: 0.7,
  opacity: 1,
  rotation: 0,
};

export type TimelineTake = {
  /** Missing in legacy video takes. */
  sourceType?: 'image' | 'video' | 'audio';
  id: string;
  assetId: string;
  sourceUrl: string;
  name: string;
  sourceDuration: number;
  sourceGenerationId: string | null;
  prompt: string;
  createdAt: string;
};

export type TimelineClip = {
  id: string;
  assetId: string;
  sourceUrl: string;
  trackId: string;
  name: string;
  sourceType: 'image' | 'video' | 'audio' | 'caption';
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  sourceDuration: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  text?: string;
  audioRole?: TimelineAudioRole;
  /** Lowers this music or sound clip while a voice clip plays; see audio-ducking.ts. */
  ducking?: AudioDucking;
  /** Playback rate of a base-track video (0.25–4, omitted is 1); duration is the source range divided by it. */
  speed?: number;
  overlay: TimelineOverlayTransform | null;
  motion?: OverlayMotion;
  /** How this base-track visual enters; see transition-contract.ts. */
  transition?: TimelineTransition;
  /** Caption word timing in source seconds; see caption-words.ts. */
  words?: CaptionWord[];
  caption: TimelineCaptionTransform | null;
  takes: TimelineTake[];
  activeTakeId: string | null;
};

export type TimelineTrack = {
  id: string;
  kind: TimelineTrackKind;
  name: string;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  clips: TimelineClip[];
};

export type TimelineDocument = {
  schemaVersion: typeof TIMELINE_SCHEMA_VERSION;
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  duration: number;
  lastRenderAssetId: string | null;
  lastRenderUrl: string | null;
  captionStyle: CaptionStylePreset;
  /** #RRGGBB colour for the word being spoken, or none. */
  captionHighlight?: string | null;
  tracks: TimelineTrack[];
};

export const MAX_TIMELINE_DOCUMENT_BYTES = 2 * 1024 * 1024;

export class TimelineDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineDocumentValidationError';
  }
}


const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const finiteNonNegative = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const roundTime = (value: number) => Math.round(value * 1000) / 1000;

export function calculateTimelineDuration(tracks: readonly TimelineTrack[]) {
  return roundTime(
    tracks.reduce(
      (timelineEnd, track) =>
        track.clips.reduce(
          (trackEnd, clip) =>
            Math.max(trackEnd, clip.startTime + clip.duration),
          timelineEnd
        ),
      0
    )
  );
}

export function createTimelineDocument({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
}): TimelineDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: createId('timeline'),
    projectId,
    name,
    createdAt: now,
    updatedAt: now,
    duration: 0,
    lastRenderAssetId: null,
    lastRenderUrl: null,
    captionStyle: 'classic',
    tracks: [
      {
        id: createId('video-track'),
        kind: 'video',
        name: 'Visual 1',
        locked: false,
        hidden: false,
        muted: false,
        clips: [],
      },
      {
        id: createId('overlay-track'),
        kind: 'overlay',
        name: 'Overlay 1',
        locked: false,
        hidden: false,
        muted: false,
        clips: [],
      },
      {
        id: createId('audio-track'),
        kind: 'audio',
        name: 'Audio 1',
        locked: false,
        hidden: false,
        muted: false,
        clips: [],
      },
      {
        id: createId('caption-track'),
        kind: 'caption',
        name: 'Captions',
        locked: false,
        hidden: false,
        muted: false,
        clips: [],
      },
    ],
  };
}

export function withUpdatedTracks(
  document: TimelineDocument,
  tracks: TimelineTrack[]
): TimelineDocument {
  return {
    ...document,
    tracks,
    duration: calculateTimelineDuration(tracks),
    updatedAt: new Date().toISOString(),
  };
}

export function addSourceClip(
  document: TimelineDocument,
  source: {
    assetId: string;
    sourceUrl?: string;
    name: string;
    sourceType: 'image' | 'video' | 'audio';
    sourceDuration: number;
    startTime?: number;
    audioRole?: TimelineAudioRole;
    clipId?: string;
  }
) {
  const sourceDuration = roundTime(finiteNonNegative(source.sourceDuration));
  if (sourceDuration <= 0) return document;

  const targetKind = source.sourceType === 'audio' ? 'audio' : 'video';
  const existingTrack = document.tracks.find((track) => track.kind === targetKind);
  if (!existingTrack) return document;
  if (
    source.clipId &&
    existingTrack.clips.some((clip) => clip.id === source.clipId)
  ) {
    return document;
  }

  const startTime = roundTime(
    finiteNonNegative(
      source.startTime ??
        existingTrack.clips.reduce(
          (end, candidate) =>
            Math.max(end, candidate.startTime + candidate.duration),
          0
        )
    )
  );
  const clip: TimelineClip = {
    id: source.clipId?.trim() || createId('clip'),
    assetId: source.assetId,
    sourceUrl: source.sourceUrl ?? '',
    trackId: existingTrack.id,
    name: source.name,
    sourceType: source.sourceType,
    startTime,
    duration: sourceDuration,
    inPoint: 0,
    outPoint: sourceDuration,
    sourceDuration,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    text: '',
    audioRole: source.audioRole,
    // Music added to a timeline steps aside for voices unless the editor turns it off.
    ...(source.sourceType === 'audio' && source.audioRole === 'music' ? { ducking: DEFAULT_DUCKING } : {}),
    overlay: null,
    caption: null,
    takes: [],
    activeTakeId: null,
  };

  return withUpdatedTracks(
    document,
    document.tracks.map((track) =>
      track.id === existingTrack.id
        ? { ...track, clips: [...track.clips, clip] }
        : track
    )
  );
}

export function addOverlayClip(
  document: TimelineDocument,
  source: OverlaySource
) {
  const track = document.tracks.find((candidate) => candidate.kind === 'overlay');
  if (!track || !source.assetId || !source.sourceUrl) return document;
  if (source.clipId && findTimelineClip(document, source.clipId)) return document;
  const duration = roundTime(finiteNonNegative(source.duration));
  if (duration < 0.04) return document;
  const startTime = roundTime(finiteNonNegative(source.startTime));
  const inPoint = source.sourceType === 'video' ? source.inPoint ?? 0 : 0;
  if (source.sourceType === 'video' && (!source.sourceDuration || inPoint < 0 || inPoint + duration > source.sourceDuration)) return document;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const overlay: TimelineOverlayTransform = {
    x: clamp(source.x ?? DEFAULT_OVERLAY_TRANSFORM.x, 0, 1),
    y: clamp(source.y ?? DEFAULT_OVERLAY_TRANSFORM.y, 0, 1),
    width: clamp(source.width ?? DEFAULT_OVERLAY_TRANSFORM.width, 0.05, 2),
    opacity: clamp(source.opacity ?? DEFAULT_OVERLAY_TRANSFORM.opacity, 0, 1),
    rotation: clamp(
      source.rotation ?? DEFAULT_OVERLAY_TRANSFORM.rotation,
      -180,
      180
    ),
  };
  const clip: TimelineClip = {
    id: source.clipId?.trim() || createId('overlay'),
    assetId: source.assetId,
    sourceUrl: source.sourceUrl,
    trackId: track.id,
    name: source.name,
    sourceType: source.sourceType ?? 'image',
    startTime,
    duration,
    inPoint,
    outPoint: inPoint + duration,
    sourceDuration: source.sourceType === 'video' ? source.sourceDuration! : duration,
    volume: 1,
    muted: false,
    fadeIn: clamp(source.fadeIn ?? 0, 0, duration),
    fadeOut: clamp(source.fadeOut ?? 0, 0, duration),
    text: '',
    overlay,
    caption: null,
    takes: [],
    activeTakeId: null,
  };
  return withUpdatedTracks(
    document,
    document.tracks.map((candidate) =>
      candidate.id === track.id
        ? { ...candidate, clips: [...candidate.clips, clip] }
        : candidate
    )
  );
}

export function normalizeTimelineDocument(
  value: unknown,
  expectedProjectId?: string
): TimelineDocument {
  const migrated = migrateLegacyTimeline(value);
  const parsedResult = timelineDocumentSchema.safeParse(migrated);
  if (!parsedResult.success) {
    throw new TimelineDocumentValidationError(
      parsedResult.error.issues[0]?.message ?? 'Timeline document is invalid.'
    );
  }
  const parsed = parsedResult.data;
  if (expectedProjectId && parsed.projectId !== expectedProjectId) {
    throw new TimelineDocumentValidationError(
      'Timeline project id does not match the route project.'
    );
  }
  for (const track of parsed.tracks) {
    for (const clip of track.clips) {
      if (clip.words && (track.kind !== 'caption' || !validateCaptionWords(clip.words, clip.sourceDuration))) throw new TimelineDocumentValidationError('Caption word timings must be ordered and fit their caption.');
      if (clip.transition && (track.kind !== 'video' || !['image', 'video'].includes(clip.sourceType))) throw new TimelineDocumentValidationError('Transitions belong to visual clips on a base track.');
      if (clip.motion && (track.kind !== 'overlay' || !clip.overlay || !['image', 'video'].includes(clip.sourceType))) throw new TimelineDocumentValidationError('Motion needs a visual overlay.');
      if (clip.ducking && (clip.sourceType !== 'audio' || clip.audioRole === 'voice')) throw new TimelineDocumentValidationError('Ducking belongs to music and sound clips, not voices.');
      if (clip.speed !== undefined && (track.kind !== 'video' || clip.sourceType !== 'video')) throw new TimelineDocumentValidationError('Speed belongs to video clips on the base track.');
      if (clip.trackId !== track.id) {
        throw new TimelineDocumentValidationError(
          'Timeline clip points to a different track.'
        );
      }
      if (
        clip.sourceType !== 'caption' &&
        (!clip.sourceUrl ||
          clip.outPoint <= clip.inPoint ||
          clip.outPoint > clip.sourceDuration)
      ) {
        throw new TimelineDocumentValidationError(
          'Timeline clip has an invalid source range.'
        );
      }
      if (
        clip.sourceType === 'caption' &&
        (clip.outPoint <= clip.inPoint || clip.outPoint > clip.sourceDuration)
      ) {
        throw new TimelineDocumentValidationError(
          'Timeline clip has an invalid source range.'
        );
      }
      if (clip.takes.some(take => (take.sourceType ?? 'video') !== clip.sourceType)) {
        throw new TimelineDocumentValidationError('Timeline take media kind must match its clip.');
      }
      if (
        clip.activeTakeId &&
        !clip.takes.some((take) => take.id === clip.activeTakeId)
      ) {
        throw new TimelineDocumentValidationError(
          'Timeline clip points to a missing take.'
        );
      }
      if (
        (track.kind === 'overlay' &&
          (!['image', 'video'].includes(clip.sourceType) || !clip.overlay)) ||
        (track.kind !== 'overlay' && clip.overlay)
      ) {
        throw new TimelineDocumentValidationError(
          'Timeline overlay metadata does not match its track.'
        );
      }
      if (
        (track.kind === 'caption' && clip.sourceType !== 'caption') ||
        (track.kind !== 'caption' && clip.caption)
      ) {
        throw new TimelineDocumentValidationError(
          'Timeline caption metadata does not match its track.'
        );
      }
    }
  }
  let tracks: TimelineTrack[] = parsed.tracks;
  if (!tracks.some((track) => track.kind === 'overlay')) {
    const overlayTrack: TimelineTrack = {
      id: createId('overlay-track'),
      kind: 'overlay',
      name: 'Overlay 1',
      locked: false,
      hidden: false,
      muted: false,
      clips: [],
    };
    const baseTrackIndex = tracks.findIndex((track) => track.kind === 'video');
    tracks = [
      ...tracks.slice(0, baseTrackIndex + 1),
      overlayTrack,
      ...tracks.slice(baseTrackIndex + 1),
    ];
  }
  if (!tracks.some((track) => track.kind === 'caption')) {
    tracks = [
      ...tracks,
      {
        id: createId('caption-track'),
        kind: 'caption' as const,
        name: 'Captions',
        locked: false,
        hidden: false,
        muted: false,
        clips: [],
      },
    ];
  }
  return {
    ...parsed,
    tracks,
    duration: calculateTimelineDuration(tracks),
  };
}

export function isOverlayClip(document: TimelineDocument, clipId: string) {
  return document.tracks.some(
    (track) =>
      track.kind === 'overlay' && track.clips.some((clip) => clip.id === clipId)
  );
}

export function findOverlayClipsAtTime(
  document: TimelineDocument,
  timelineTime: number
) {
  return document.tracks.flatMap((track) =>
    track.kind !== 'overlay' || track.hidden || track.muted
      ? []
      : track.clips.filter(
          (clip) =>
            timelineTime >= clip.startTime &&
            timelineTime < clip.startTime + clip.duration
        )
  );
}

export function overlayOpacityAt(clip: TimelineClip, timelineTime: number) {
  if (!clip.overlay || clip.muted) return 0;
  const offset = timelineTime - clip.startTime;
  if (offset < 0 || offset >= clip.duration) return 0;
  const fadeIn = clip.fadeIn > 0 ? Math.min(1, offset / clip.fadeIn) : 1;
  const fadeOut =
    clip.fadeOut > 0
      ? Math.min(1, (clip.duration - offset) / clip.fadeOut)
      : 1;
  return Math.max(
    0,
    Math.min(1, overlayTransformAt(clip, timelineTime)!.opacity * Math.min(fadeIn, fadeOut))
  );
}

export function updateTimelineOverlay(document: TimelineDocument, clipId: string, patch: OverlayPatch, atTime?: number) {
  const clip = findTimelineClip(document, clipId);
  if (!clip?.overlay || !isOverlayClip(document, clipId) || document.tracks.some(track => track.id === clip.trackId && track.locked)) return document;
  return withUpdatedTracks(document, document.tracks.map(track => ({ ...track,
    clips: track.clips.map(candidate => candidate.id === clipId ? patchOverlayClip(candidate, patch, atTime) : candidate),
  })));
}

export function setTimelineOverlayMotion(document: TimelineDocument, clipId: string, motion: OverlayMotion | null) {
  const clip = findTimelineClip(document, clipId);
  if (!clip?.overlay || !isOverlayClip(document, clipId) || document.tracks.some(track => track.id === clip.trackId && track.locked)) return document;
  const parsed = motion === null ? undefined : overlayMotionSchema.parse(motion);
  return withUpdatedTracks(document, document.tracks.map(track => ({ ...track,
    clips: track.clips.map(candidate => {
      if (candidate.id !== clipId) return candidate;
      const { motion: _old, ...rest } = candidate;
      return parsed ? { ...rest, motion: parsed } : rest;
    }),
  })));
}

export function replaceTimelineOverlayAsset(
  document: TimelineDocument,
  clipId: string,
  source: { assetId: string; sourceUrl: string; name: string }
) {
  const clip = findTimelineClip(document, clipId);
  if (
    !clip?.overlay || clip.sourceType !== 'image' ||
    !isOverlayClip(document, clipId) ||
    !source.assetId ||
    !source.sourceUrl ||
    !source.name
  ) {
    return document;
  }
  return withUpdatedTracks(
    document,
    document.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((candidate) =>
        candidate.id === clipId
          ? {
              ...candidate,
              assetId: source.assetId,
              sourceUrl: source.sourceUrl,
              name: source.name,
            }
          : candidate
      ),
    }))
  );
}

export function getTimelineClipSource(clip: TimelineClip) {
  const take = clip.activeTakeId
    ? clip.takes.find((candidate) => candidate.id === clip.activeTakeId)
    : null;
  return take
    ? {
        assetId: take.assetId,
        sourceUrl: take.sourceUrl,
        name: take.name,
        sourceDuration: take.sourceDuration,
        inPoint: 0,
        outPoint: Math.min(take.sourceDuration, clip.duration * (clip.speed ?? 1)),
        take,
      }
    : {
        assetId: clip.assetId,
        sourceUrl: clip.sourceUrl,
        name: clip.name,
        sourceDuration: clip.sourceDuration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        take: null,
      };
}

export function addTimelineTake(
  document: TimelineDocument,
  clipId: string,
  input: Omit<TimelineTake, 'id' | 'createdAt'> & {
    id?: string;
    createdAt?: string;
  }
) {
  const clip = findTimelineClip(document, clipId);
  if (
    !clip ||
    clip.sourceType !== (input.sourceType ?? 'video') ||
    document.tracks.some(track => track.id === clip.trackId && track.locked) ||
    (clip.sourceType !== 'image' && input.sourceDuration < clip.duration - 0.05)
  ) {
    return document;
  }
  const take: TimelineTake = {
    ...input,
    id: input.id ?? createId('take'),
    createdAt: input.createdAt ?? new Date().toISOString(),
    sourceDuration: roundTime(input.sourceDuration),
  };
  return withUpdatedTracks(
    document,
    document.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((candidate) =>
        candidate.id === clipId
          ? {
              ...candidate,
              takes: [
                ...candidate.takes.filter((item) => item.id !== take.id),
                take,
              ],
            }
          : candidate
      ),
    }))
  );
}

export function activateTimelineTake(
  document: TimelineDocument,
  clipId: string,
  takeId: string | null
) {
  const clip = findTimelineClip(document, clipId);
  const take = takeId
    ? clip?.takes.find((candidate) => candidate.id === takeId)
    : null;
  if (
    !clip ||
    document.tracks.some(track => track.id === clip.trackId && track.locked) ||
    (takeId && !take) ||
    (take && (take.sourceType ?? 'video') !== clip.sourceType) ||
    (take && clip.sourceType !== 'image' && take.sourceDuration < clip.duration - 0.05)
  ) {
    return document;
  }
  return withUpdatedTracks(
    document,
    document.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((candidate) =>
        candidate.id === clipId
          ? { ...candidate, activeTakeId: takeId }
          : candidate
      ),
    }))
  );
}

export function setTimelineRender(
  document: TimelineDocument,
  asset: { id: string; publicUrl: string }
): TimelineDocument {
  return {
    ...document,
    lastRenderAssetId: asset.id,
    lastRenderUrl: asset.publicUrl,
    updatedAt: new Date().toISOString(),
  };
}

export function findTimelineClip(
  document: TimelineDocument,
  clipId: string
) {
  return document.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === clipId);
}

export function trimTimelineClip(
  document: TimelineDocument,
  clipId: string,
  nextInPoint: number,
  nextOutPoint: number
) {
  const clip = findTimelineClip(document, clipId);
  if (!clip) return document;

  const inPoint = roundTime(
    Math.min(clip.sourceDuration, finiteNonNegative(nextInPoint))
  );
  const outPoint = roundTime(
    Math.min(clip.sourceDuration, finiteNonNegative(nextOutPoint))
  );
  if (outPoint - inPoint < 0.04) return document;
  return replaceTimelineClip(document, clipId, { ...clip, inPoint, outPoint, duration: roundTime((outPoint - inPoint) / (clip.speed ?? 1)) });
}

export function resizeTimelineClip(
  document: TimelineDocument,
  clipId: string,
  nextDuration: number
) {
  const clip = findTimelineClip(document, clipId);
  if (!clip || clip.sourceType !== 'image') return document;
  const duration = roundTime(finiteNonNegative(nextDuration));
  if (duration < 0.04) return document;

  return withUpdatedTracks(
    document,
    document.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((candidate) =>
        candidate.id === clipId
          ? {
              ...candidate,
              duration,
              inPoint: candidate.motion ? candidate.inPoint : 0,
              outPoint: (candidate.motion ? candidate.inPoint : 0) + duration,
              sourceDuration: candidate.motion ? Math.max(candidate.sourceDuration, candidate.inPoint + duration) : duration,
            }
          : candidate
      ),
    }))
  );
}

export function splitTimelineClip(
  document: TimelineDocument,
  clipId: string,
  sourceTime: number,
  rightClipId?: string
) {
  const clip = findTimelineClip(document, clipId);
  if (!clip || clip.activeTakeId) return document;
  if (
    rightClipId &&
    document.tracks.some((track) =>
      track.clips.some((candidate) => candidate.id === rightClipId)
    )
  ) {
    return document;
  }

  const splitPoint = roundTime(sourceTime);
  if (splitPoint - clip.inPoint < 0.04 || clip.outPoint - splitPoint < 0.04) {
    return document;
  }

  const left: TimelineClip = {
    ...clip,
    outPoint: splitPoint,
    duration: roundTime((splitPoint - clip.inPoint) / (clip.speed ?? 1)),
  };
  const { transition: _entry, ...rightSource } = clip;
  const right: TimelineClip = {
    ...rightSource,
    id: rightClipId?.trim() || createId('clip'),
    startTime: roundTime(clip.startTime + left.duration),
    inPoint: splitPoint,
    duration: roundTime((clip.outPoint - splitPoint) / (clip.speed ?? 1)),
  };

  return withUpdatedTracks(
    document,
    document.tracks.map((track) => ({
      ...track,
      clips: track.clips.flatMap((candidate) =>
        candidate.id === clipId ? [left, right] : [candidate]
      ),
    }))
  );
}

export function removeTimelineClip(
  document: TimelineDocument,
  clipId: string
) {
  return withUpdatedTracks(
    document,
    document.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => clip.id !== clipId),
    }))
  );
}

export function moveTimelineClip(
  document: TimelineDocument,
  clipId: string,
  nextStartTime: number
) {
  const clip = findTimelineClip(document, clipId);
  if (!clip) return document;
  const startTime = roundTime(finiteNonNegative(nextStartTime));
  const endTime = startTime + clip.duration;
  const track = document.tracks.find((candidate) => candidate.id === clip.trackId);
  if (
    track?.clips.some(
      (candidate) =>
        candidate.id !== clipId &&
        startTime < candidate.startTime + candidate.duration &&
        endTime > candidate.startTime
    )
  ) {
    return document;
  }
  return withUpdatedTracks(
    document,
    document.tracks.map((candidate) => ({
      ...candidate,
      clips: candidate.clips.map((item) =>
        item.id === clipId ? { ...item, startTime } : item
      ),
    }))
  );
}

export function rippleDeleteTimelineClip(
  document: TimelineDocument,
  clipId: string
) {
  const clip = findTimelineClip(document, clipId);
  if (!clip) return document;
  return withUpdatedTracks(
    document,
    document.tracks.map((track) =>
      track.id !== clip.trackId
        ? track
        : {
            ...track,
            clips: track.clips
              .filter((candidate) => candidate.id !== clipId)
              .map((candidate) =>
                candidate.startTime > clip.startTime
                  ? {
                      ...candidate,
                      startTime: roundTime(
                        Math.max(clip.startTime, candidate.startTime - clip.duration)
                      ),
                    }
                  : candidate
              ),
          }
    )
  );
}

export function updateTimelineAudioClip(
  document: TimelineDocument,
  clipId: string,
  patch: Partial<Pick<TimelineClip, 'volume' | 'muted' | 'fadeIn' | 'fadeOut'>> & { ducking?: (Partial<AudioDucking> & { level: number }) | null }
) {
  const clip = findTimelineClip(document, clipId);
  if (!clip || !['audio', 'video'].includes(clip.sourceType)) return document;
  const span = (value: number | undefined, fallback: number) => typeof value === 'number' ? Math.max(0, Math.min(clip.duration, value)) : fallback;
  const next: TimelineClip = {
    ...clip,
    volume: typeof patch.volume === 'number' ? Math.max(0, Math.min(4, patch.volume)) : clip.volume,
    muted: patch.muted ?? clip.muted,
    fadeIn: span(patch.fadeIn, clip.fadeIn),
    fadeOut: span(patch.fadeOut, clip.fadeOut),
  };
  // null turns ducking off; a level turns it on with the default ramps unless they are given.
  if (patch.ducking === null) delete next.ducking;
  else if (patch.ducking) next.ducking = normalizeDucking(patch.ducking);
  return replaceTimelineClip(document, clipId, next);
}

/** Replaces one clip and recomputes the timeline length. */
export const replaceTimelineClip = (document: TimelineDocument, clipId: string, next: TimelineClip) =>
  withUpdatedTracks(document, document.tracks.map((track) => ({ ...track, clips: track.clips.map((candidate) => candidate.id === clipId ? next : candidate) })));
