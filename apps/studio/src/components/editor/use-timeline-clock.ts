import { useCallback, useEffect, useRef } from 'react';

/**
 * One playback clock for the whole timeline. Each animation frame reports the timeline time to
 * `onTick`; returning false (media still loading) holds the clock instead of skipping ahead.
 * Playback runs through cuts, gaps and transitions and stops at the end.
 */
export function useTimelineClock({ duration, onTick, onStop }: {
  duration: number;
  onTick: (time: number) => boolean;
  onStop: (time: number) => void;
}) {
  const frame = useRef<number | null>(null);
  const origin = useRef<{ wall: number; time: number } | null>(null);
  const latest = useRef({ duration, onTick, onStop });
  latest.current = { duration, onTick, onStop };

  const now = () => {
    const anchor = origin.current;
    return anchor ? Math.min(latest.current.duration, anchor.time + (performance.now() - anchor.wall) / 1000) : 0;
  };
  const halt = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    origin.current = null;
  };
  const stop = useCallback(() => {
    if (!origin.current) return;
    const time = now();
    halt();
    latest.current.onStop(time);
  }, []);
  const start = useCallback((from: number) => {
    halt();
    let shown = Math.max(0, Math.min(from, latest.current.duration));
    origin.current = { wall: performance.now(), time: shown };
    const tick = (wall: number) => {
      const anchor = origin.current;
      if (!anchor) return;
      const time = Math.min(latest.current.duration, anchor.time + (wall - anchor.wall) / 1000);
      // Loading media holds the clock at the last frame that was ready.
      if (latest.current.onTick(time)) shown = time;
      else origin.current = { wall, time: shown };
      if (time >= latest.current.duration) {
        halt();
        latest.current.onStop(time);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, []);
  const running = useCallback(() => origin.current !== null, []);
  useEffect(() => halt, []);
  return { start, stop, running };
}
