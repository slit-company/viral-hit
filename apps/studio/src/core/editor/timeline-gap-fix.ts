import type { EditorOperation } from '@/core/commands/editor-commands';
import { diagnoseTimeline } from './timeline-diagnostics';
import type { TimelineDocument } from './timeline-document';

/**
 * When narration or music runs past the last visual and that visual is a still image,
 * holding the image to the end is the obvious repair. Other gaps need a person's choice.
 */
export function trailingGapFix(document: TimelineDocument): EditorOperation | null {
  const blocking = diagnoseTimeline(document).find(diagnostic => diagnostic.severity === 'error');
  if (blocking?.code !== 'timeline_gap' || blocking.clipId || blocking.endTime === undefined) return null;
  const last = document.tracks
    .filter(track => track.kind === 'video' && !track.hidden && !track.muted)
    .flatMap(track => track.clips)
    .sort((left, right) => left.startTime + left.duration - (right.startTime + right.duration))
    .at(-1);
  if (!last || last.sourceType !== 'image' || last.activeTakeId) return null;
  return { type: 'set_clip_duration', clipId: last.id, duration: Math.round((blocking.endTime - last.startTime) * 1000) / 1000 };
}
