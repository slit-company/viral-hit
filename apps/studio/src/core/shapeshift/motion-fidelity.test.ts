import test from 'node:test';
import assert from 'node:assert/strict';
import { motionFidelity } from './motion-fidelity';

const W = 24, H = 12;
/** A bright square moving across a dark frame: x positions per frame. */
const clip = (positions: number[]) => positions.map(x => {
  const frame = new Uint8Array(W * H);
  for (let y = 4; y < 8; y++) for (let dx = 0; dx < 4; dx++) frame[y * W + Math.min(W - 1, x + dx)] = 220;
  return frame;
});
const walk = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
const pause = [0, 6, 6, 6, 12, 12, 12, 18, 18, 18];

test('the same movement scores high and a different rhythm or place scores lower', () => {
  const same = motionFidelity(clip(walk), clip(walk), W, H)!;
  assert.deepEqual(same, { layout: 1, timing: 1 });
  const rhythm = motionFidelity(clip(walk), clip(pause), W, H)!;
  assert.ok(rhythm.timing < 0.5, 'stop-and-go timing differs from a steady walk');
  const reversed = motionFidelity(clip(walk), clip([...walk].reverse()), W, H)!;
  assert.ok(reversed.layout < same.layout, 'moving the other way changes where things move');
});

test('two still clips move alike and too few frames give no score', () => {
  assert.deepEqual(motionFidelity(clip([5, 5, 5, 5, 5]), clip([9, 9, 9, 9, 9]), W, H), { layout: 1, timing: 1 });
  assert.equal(motionFidelity(clip([0, 2, 4]), clip([0, 2, 4]), W, H), null);
});
