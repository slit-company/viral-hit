import { useEffect, useRef } from 'react';
import { getTimelineClipSource, type TimelineClip } from '@/core/editor/timeline-document';

/** Use the timeline clock for source seeks; the native video decodes only while this overlay is visible. */
export function OverlayMedia({ clip, time, playing }: { clip: TimelineClip; time: number; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const source = getTimelineClipSource(clip);
  const sync = () => {
    const video = ref.current;
    if (!video || video.readyState < 1) return;
    const offset = Math.max(0, Math.min(clip.duration, time - clip.startTime));
    const target = Math.min(source.outPoint - .000001, source.inPoint + offset);
    if (Math.abs(video.currentTime - target) > (playing ? .12 : .001)) video.currentTime = target;
    const gain = Math.min(clip.fadeIn ? offset / clip.fadeIn : 1, clip.fadeOut ? (clip.duration - offset) / clip.fadeOut : 1, 1);
    video.volume = Math.max(0, Math.min(1, clip.volume * gain));
    if (playing) { if (video.paused) void video.play().catch(() => undefined); }
    else video.pause();
  };
  useEffect(sync, [time, playing, source.sourceUrl, clip]);
  useEffect(() => { const video = ref.current; return () => video?.pause(); }, []);
  const className = 'pointer-events-none block h-auto w-full select-none';
  return clip.sourceType === 'video'
    ? <video ref={ref} src={source.sourceUrl} playsInline preload="metadata" onLoadedMetadata={sync} className={className} aria-label={clip.name} />
    : <img src={source.sourceUrl} alt="" draggable={false} className={className} />;
}
