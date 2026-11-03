import { useEffect, useState } from 'react';

/** A video's length in seconds, read by the browser from its metadata; null until it is known. */
export function useVideoLength(url: string | null) {
  const [known, setKnown] = useState<{ url: string; seconds: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let active = true;
    const video = document.createElement('video');
    video.preload = 'metadata'; video.muted = true;
    video.onloadedmetadata = () => { if (active && Number.isFinite(video.duration) && video.duration > 0) setKnown({ url, seconds: video.duration }); };
    video.src = url;
    return () => { active = false; video.onloadedmetadata = null; video.removeAttribute('src'); video.load(); };
  }, [url]);
  return known?.url === url ? known.seconds : null;
}
