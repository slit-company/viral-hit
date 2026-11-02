import type { OverlayMotion } from '../editor/overlay-motion';
import type { CameraMove } from './motion';

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round = (value: number) => Math.round(value * 10000) / 10000 + 0;

/**
 * Overlay keyframes that give a still image a reference shot's camera move. Overlays are placed by their
 * centre with a width relative to the frame, so the image always covers the whole frame while it moves.
 * Static and handheld shots keep the still unmoved (null).
 */
export function cameraKeyframes(move: CameraMove, duration: number, imageAspect: number, frameAspect: number): OverlayMotion | null {
  if (!(duration > 0) || !(imageAspect > 0) || !(frameAspect > 0)) return null;
  const cover = Math.max(1, imageAspect / frameAspect);
  let from = { x: 0.5, y: 0.5, width: cover }, to = { ...from };
  if (move.kind === 'zoom-in' || move.kind === 'zoom-out') {
    const factor = clamp(move.kind === 'zoom-in' ? move.zoom : 1 / move.zoom, 1.06, 1.35), wide = Math.min(2, cover * factor);
    if (wide <= cover + 0.01) return null;
    [from, to] = move.kind === 'zoom-in' ? [{ ...from, width: cover }, { ...from, width: wide }] : [{ ...from, width: wide }, { ...from, width: cover }];
  } else if (move.kind === 'pan-left' || move.kind === 'pan-right') {
    let travel = clamp(Math.abs(move.pan) / 2, 0.03, 0.12);
    const width = Math.min(2, Math.max(cover, 1 + 2 * travel));
    travel = Math.min(travel, (width - 1) / 2);
    // The camera moving right shows the image's right side, so the image itself moves left.
    const sign = move.kind === 'pan-right' ? 1 : -1;
    from = { x: 0.5 + sign * travel, y: 0.5, width }; to = { x: 0.5 - sign * travel, y: 0.5, width };
  } else if (move.kind === 'tilt-up' || move.kind === 'tilt-down') {
    let travel = clamp(Math.abs(move.tilt) / 2, 0.03, 0.12);
    const width = Math.min(2, Math.max(cover, ((1 + 2 * travel) * imageAspect) / frameAspect));
    travel = Math.min(travel, ((width * frameAspect) / imageAspect - 1) / 2);
    const sign = move.kind === 'tilt-down' ? 1 : -1;
    from = { x: 0.5, y: 0.5 + sign * travel, width }; to = { x: 0.5, y: 0.5 - sign * travel, width };
  } else return null;
  if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) + Math.abs(from.width - to.width) < 0.005) return null;
  const pose = (value: typeof from) => ({ x: round(value.x), y: round(value.y), width: round(value.width), opacity: 1, rotation: 0 });
  return { version: 1, keyframes: [
    { id: 'camera-start', time: 0, ...pose(from), easing: 'linear' },
    { id: 'camera-end', time: round(duration), ...pose(to), easing: 'linear' },
  ] };
}
