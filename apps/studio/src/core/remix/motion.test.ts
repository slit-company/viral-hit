import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraMove, estimateMotion, speedSignals, type MotionSample } from './motion';

const pattern = (u: number, v: number) => 128 + 50 * Math.sin(0.31 * u + 0.17 * v) + 40 * Math.sin(0.13 * u - 0.29 * v + 1) + 30 * Math.sin(0.07 * u + 0.05 * v);
/** A frame whose content moved by (dx, dy) and grew by zoom about the centre. */
function frame(width: number, height: number, dx = 0, dy = 0, zoom = 1) {
  const pixels = new Uint8Array(width * height), cx = (width - 1) / 2, cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = Math.max(0, Math.min(255, Math.round(pattern(cx + (x - cx - dx) / zoom, cy + (y - cy - dy) / zoom))));
  return pixels;
}
const still = (count: number, sample: Partial<MotionSample> = {}) => Array.from({ length: count }, () => ({ dx: 0, dy: 0, zoom: 1, diff: 4, ...sample }));

test('global motion is recovered to a fraction of a pixel and a fraction of a percent', () => {
  for (const [width, height] of [[96, 54], [96, 170]]) {
    const base = frame(width, height);
    const moved = estimateMotion(base, frame(width, height, 2.3, -1.6), width, height);
    assert.ok(Math.abs(moved.dx - 2.3) < 0.35 && Math.abs(moved.dy + 1.6) < 0.35, JSON.stringify(moved));
    assert.ok(Math.abs(moved.zoom - 1) < 0.006, JSON.stringify(moved));
    const zoomed = estimateMotion(base, frame(width, height, 0, 0, 1.03), width, height);
    assert.ok(Math.abs(zoomed.zoom - 1.03) < 0.008 && Math.abs(zoomed.dx) < 0.35, JSON.stringify(zoomed));
    const same = estimateMotion(base, base, width, height);
    assert.deepEqual([same.dx, same.dy, same.diff], [0, 0, 0]); assert.ok(Math.abs(same.zoom - 1) < 0.001);
  }
  assert.throws(() => estimateMotion(new Uint8Array(4), new Uint8Array(4), 2, 2));
  // Vertical stripes moving sideways only reveal horizontal motion; the vertical shift stays zero.
  const stripes = (shift: number) => Uint8Array.from({ length: 96 * 54 }, (_, index) => Math.round(128 + 90 * Math.sin(((index % 96) - shift) * 0.4)));
  const sideways = estimateMotion(stripes(0), stripes(2), 96, 54);
  assert.ok(Math.abs(sideways.dx - 2) < 0.35 && sideways.dy === 0, JSON.stringify(sideways));
  // A flat frame has no motion to measure: no candidate may win by tie-breaking.
  const flat = new Uint8Array(96 * 54).fill(180), plain = estimateMotion(flat, flat, 96, 54);
  assert.deepEqual([plain.dx, plain.dy, plain.zoom, plain.diff], [0, 0, 1, 0]);
});

test('a run of samples becomes the camera move a viewer would describe', () => {
  assert.deepEqual(cameraMove(still(16, { dx: -1.5 }), 96, 54), { kind: 'pan-right', pan: 0.25, tilt: 0, zoom: 1 });
  assert.equal(cameraMove(still(16, { dx: 1.5 }), 96, 54).kind, 'pan-left');
  assert.equal(cameraMove(still(16, { dy: 1.2 }), 96, 54).kind, 'tilt-up');
  assert.equal(cameraMove(still(16, { zoom: 1.01 }), 96, 54).kind, 'zoom-in');
  assert.equal(cameraMove(still(16, { zoom: 0.99 }), 96, 54).kind, 'zoom-out');
  assert.equal(cameraMove(still(16), 96, 54).kind, 'static');
  const shaky = Array.from({ length: 16 }, (_, index) => ({ dx: index % 2 ? 0.9 : -0.9, dy: index % 3 ? 0.7 : -0.7, zoom: 1, diff: 6 }));
  assert.equal(cameraMove(shaky, 96, 54).kind, 'handheld');
});

test('freeze frames and a clear change of pace inside a shot are reported', () => {
  const samples = [...still(6), ...still(5, { diff: 0.1 }), ...still(5)];
  assert.deepEqual(speedSignals(samples, 8, 10), { freezes: [{ start: 10.75, end: 11.375 }], ramp: null });
  assert.equal(speedSignals([...still(8, { diff: 2 }), ...still(8, { dx: 2.5, diff: 20 })], 8, 0).ramp, 'up');
  assert.equal(speedSignals([...still(8, { dx: 2.5, diff: 20 }), ...still(8, { diff: 2 })], 8, 0).ramp, 'down');
  assert.equal(speedSignals(still(6, { dx: 2 }), 8, 0).ramp, null);
});
