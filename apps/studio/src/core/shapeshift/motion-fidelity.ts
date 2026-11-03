/**
 * How closely a result moves like its source, from small grayscale frames sampled at the same rate over
 * the same span. Each step between frames becomes a grid of motion energy: layout compares where and
 * when things move, timing compares only when (it ignores where the subject sits in the frame).
 */
export type MotionFidelity = { layout: number; timing: number };
const COLS = 6, ROWS = 4;

function energy(previous: Uint8Array, next: Uint8Array, width: number, height: number) {
  const cells = new Float64Array(COLS * ROWS), counts = new Float64Array(COLS * ROWS);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = Math.min(ROWS - 1, Math.floor(y * ROWS / height)) * COLS + Math.min(COLS - 1, Math.floor(x * COLS / width));
    cells[cell] += Math.abs(next[y * width + x] - previous[y * width + x]); counts[cell]++;
  }
  return Array.from(cells, (value, index) => value / Math.max(1, counts[index]));
}
function pearson(left: number[], right: number[]) {
  const n = Math.min(left.length, right.length);
  if (n < 3) return null;
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) { a += left[i]; b += right[i]; }
  a /= n; b /= n;
  let covariance = 0, varianceLeft = 0, varianceRight = 0;
  for (let i = 0; i < n; i++) { const x = left[i] - a, y = right[i] - b; covariance += x * y; varianceLeft += x * x; varianceRight += y * y; }
  // A still source and a still result move alike.
  if (varianceLeft < 1e-9 || varianceRight < 1e-9) return varianceLeft < 1e-9 && varianceRight < 1e-9 ? 1 : 0;
  return covariance / Math.sqrt(varianceLeft * varianceRight);
}
const clamp = (value: number | null) => value === null ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;

export function motionFidelity(source: readonly Uint8Array[], result: readonly Uint8Array[], width: number, height: number): MotionFidelity | null {
  const steps = Math.min(source.length, result.length) - 1;
  if (steps < 3) return null;
  const a: number[][] = [], b: number[][] = [];
  for (let i = 0; i < steps; i++) { a.push(energy(source[i], source[i + 1], width, height)); b.push(energy(result[i], result[i + 1], width, height)); }
  const total = (grid: number[]) => grid.reduce((sum, value) => sum + value, 0);
  return { layout: clamp(pearson(a.flat(), b.flat())), timing: clamp(pearson(a.map(total), b.map(total))) };
}
