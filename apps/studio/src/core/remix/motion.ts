/** Content motion between two frames: translation in pixels, scale about the centre and mean absolute difference (0–255). */
export type MotionSample = { dx: number; dy: number; zoom: number; diff: number };
export type CameraMoveKind = 'static' | 'handheld' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down';
/** pan/tilt are the camera's travel as a fraction of the frame; zoom is the overall magnification. */
export type CameraMove = { kind: CameraMoveKind; pan: number; tilt: number; zoom: number };
export type SpeedSignals = { freezes: { start: number; end: number }[]; ramp: 'up' | 'down' | null };

const RADIUS = 4, BORDER = 6, ZOOM_STEP = 0.02;
/** Nearest first, so equally good shifts (stripes, flat areas) resolve to the smallest movement. */
const SHIFTS = Array.from({ length: (2 * RADIUS + 1) ** 2 }, (_, index) => [index % (2 * RADIUS + 1) - RADIUS, Math.floor(index / (2 * RADIUS + 1)) - RADIUS] as const)
  .sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
// + 0 turns -0 into 0, so rounded values compare and serialise cleanly.
const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits + 0;

function sad(prev: Uint8Array, next: Uint8Array, width: number, height: number, dx: number, dy: number, scale: number, step: number) {
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  let total = 0, count = 0;
  for (let y = BORDER; y < height - BORDER; y += step) {
    const sy = Math.round(cy + (y - cy - dy) / scale);
    if (sy < 0 || sy >= height) continue;
    for (let x = BORDER; x < width - BORDER; x += step) {
      const sx = Math.round(cx + (x - cx - dx) / scale);
      if (sx < 0 || sx >= width) continue;
      total += Math.abs(next[y * width + x] - prev[sy * width + sx]); count++;
    }
  }
  return count ? total / count : Number.POSITIVE_INFINITY;
}
/** Vertex of the parabola through three equally spaced costs, as an offset in [-0.5, 0.5]. */
function vertex(left: number, centre: number, right: number) {
  const curvature = left - 2 * centre + right;
  return curvature > 0 ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curvature))) : 0;
}

/**
 * Global motion of next relative to prev (gray, row-major). A coarse integer search on every other pixel
 * is refined at full resolution, with parabolic sub-pixel translation and a three-point scale estimate.
 */
export function estimateMotion(prev: Uint8Array, next: Uint8Array, width: number, height: number): MotionSample {
  if (prev.length !== width * height || next.length !== width * height || width <= 2 * (BORDER + RADIUS) || height <= 2 * (BORDER + RADIUS)) throw new Error('Invalid motion frames');
  // Movement must clearly beat standing still, so flat or noisy frames never invent a camera move.
  const still = sad(prev, next, width, height, 0, 0, 1, 2), margin = Math.max(0.15, still * 0.03);
  let bestX = 0, bestY = 0, best = still - margin;
  for (const [dx, dy] of SHIFTS) {
    const cost = sad(prev, next, width, height, dx, dy, 1, 2);
    if (cost < best - 1e-9) { best = cost; bestX = dx; bestY = dy; }
  }
  const at = (dx: number, dy: number, scale = 1) => sad(prev, next, width, height, dx, dy, scale, 1);
  const centre = at(bestX, bestY);
  const dx = bestX + (Math.abs(bestX) < RADIUS ? vertex(at(bestX - 1, bestY), centre, at(bestX + 1, bestY)) : 0);
  const dy = bestY + (Math.abs(bestY) < RADIUS ? vertex(at(bestX, bestY - 1), centre, at(bestX, bestY + 1)) : 0);
  // Five log-spaced scales (±4%) around the best translation, refined like the translation.
  const costs = [-2, -1, 0, 1, 2].map(k => k === 0 ? centre : at(bestX, bestY, Math.exp(k * ZOOM_STEP)));
  const lowest = Math.min(...costs), k = lowest < centre - Math.max(0.15, centre * 0.03) ? costs.indexOf(lowest) - 2 : 0;
  const zoom = Math.exp(ZOOM_STEP * (k + (Math.abs(k) < 2 ? vertex(costs[k + 1], costs[k + 2], costs[k + 3]) : 0)));
  return { dx: round(dx, 3), dy: round(dy, 3), zoom: round(zoom), diff: round(at(0, 0), 3) };
}

/**
 * The camera move over a run of samples. Content moving left means the camera pans right; content growing
 * means it zooms in. Small totals are static; small totals with a lot of back-and-forth are handheld.
 */
export function cameraMove(samples: readonly MotionSample[], width: number, height: number): CameraMove {
  let sumX = 0, sumY = 0, logZoom = 0, travel = 0;
  for (const sample of samples) { sumX += sample.dx; sumY += sample.dy; logZoom += Math.log(sample.zoom); travel += Math.hypot(sample.dx, sample.dy); }
  const pan = -sumX / width, tilt = -sumY / height, zoom = Math.exp(logZoom);
  const scores: [CameraMoveKind, number][] = [
    [zoom >= 1 ? 'zoom-in' : 'zoom-out', Math.abs(Math.log(zoom)) / 0.05],
    [pan >= 0 ? 'pan-right' : 'pan-left', Math.abs(pan) / 0.08],
    [tilt >= 0 ? 'tilt-down' : 'tilt-up', Math.abs(tilt) / 0.08],
  ];
  const [kind, score] = scores.sort((a, b) => b[1] - a[1])[0];
  const shake = samples.length ? travel / samples.length / Math.max(width, height) : 0;
  return { kind: score >= 1 ? kind : shake >= 0.006 ? 'handheld' : 'static', pan: round(pan), tilt: round(tilt), zoom: round(zoom) };
}

/** Freeze frames (no change for at least 0.4 s) and a clear change of activity between a shot's halves. */
export function speedSignals(samples: readonly MotionSample[], fps: number, start: number): SpeedSignals {
  const freezes: SpeedSignals['freezes'] = [];
  let run = 0;
  samples.forEach((sample, index) => {
    if (sample.diff < 0.35) run++;
    if ((sample.diff >= 0.35 || index === samples.length - 1) && run) {
      const end = sample.diff < 0.35 ? index + 1 : index;
      if (run / fps >= 0.4) freezes.push({ start: round(start + (end - run) / fps, 3), end: round(start + end / fps, 3) });
      run = 0;
    }
  });
  const activity = (part: readonly MotionSample[]) => { const values = part.map(item => Math.hypot(item.dx, item.dy) + item.diff / 8).sort((a, b) => a - b); return values[Math.floor(values.length / 2)] ?? 0; };
  const half = Math.floor(samples.length / 2), first = activity(samples.slice(0, half)), second = activity(samples.slice(half));
  const ramp = samples.length < 8 || Math.max(first, second) < 0.6 ? null : second >= first * 2.5 ? 'up' : first >= second * 2.5 ? 'down' : null;
  return { freezes, ramp };
}
