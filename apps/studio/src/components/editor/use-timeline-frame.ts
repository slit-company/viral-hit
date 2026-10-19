import { useEffect, useState } from 'react';
import { getTimelineClipSource, type TimelineDocument } from '@/core/editor/timeline-document';
import { timelineOutputFrame } from '@/core/editor/output-frame';

/** Resolve the first exported visual, not the current selection, just like both exporters. */
export function useTimelineFrame(timeline: TimelineDocument) {
  const first = timeline.tracks.filter(track => track.kind === 'video' && !track.hidden && !track.muted)
    .flatMap(track => track.clips).find(clip => clip.sourceType === 'image' || clip.sourceType === 'video');
  const source = first ? getTimelineClipSource(first) : null;
  const url = source?.sourceUrl, kind = first?.sourceType;
  const [resolved, setResolved] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let active = true;
    const save = (width: number, height: number) => {
      if (active && width > 0 && height > 0) setResolved({ url, ...timelineOutputFrame(width, height) });
    };
    if (kind === 'image') {
      const image = new Image();
      image.onload = () => save(image.naturalWidth, image.naturalHeight);
      image.src = url;
      return () => { active = false; image.onload = null; image.src = ''; };
    }
    const video = document.createElement('video');
    video.preload = 'metadata'; video.onloadedmetadata = () => save(video.videoWidth, video.videoHeight);
    video.src = url;
    return () => { active = false; video.onloadedmetadata = null; video.removeAttribute('src'); video.load(); };
  }, [url, kind]);
  return resolved && resolved.url === url ? resolved : timelineOutputFrame(16, 9);
}
