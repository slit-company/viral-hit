import { TIMELINE_SCHEMA_VERSION } from './timeline-schema';

type Loose = Record<string, unknown>;

const isRecord = (value: unknown): value is Loose => Boolean(value && typeof value === 'object');

/** Upgrade timeline schema versions 1–5 to the current shape before validation; anything else passes through unchanged. */
export function migrateLegacyTimeline(value: unknown): unknown {
  const version = isRecord(value) ? value.schemaVersion : null;
  if (!isRecord(value) || !(version === 1 || version === 2 || version === 3 || version === 4 || version === 5)) return value;
  const migrateClip = (clip: unknown) => {
    if (!isRecord(clip)) return clip;
    return {
      ...clip,
      takes: version === 1 ? [] : (clip.takes ?? []),
      activeTakeId: version === 1 ? null : (clip.activeTakeId ?? null),
      overlay: version === 4 || version === 5 ? (clip.overlay ?? null) : null,
      caption: version === 5 ? (clip.caption ?? null) : null,
      motion: undefined,
    };
  };
  const migrateTrack = (track: unknown) => {
    if (!isRecord(track)) return track;
    return {
      ...track,
      name: track.name === 'Video 1' ? 'Visual 1' : track.name,
      clips: Array.isArray(track.clips) ? track.clips.map(migrateClip) : [],
    };
  };
  return {
    ...value,
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    lastRenderAssetId: version === 1 ? null : (value.lastRenderAssetId ?? null),
    lastRenderUrl: version === 1 ? null : (value.lastRenderUrl ?? null),
    tracks: Array.isArray(value.tracks) ? value.tracks.map(migrateTrack) : [],
  };
}
