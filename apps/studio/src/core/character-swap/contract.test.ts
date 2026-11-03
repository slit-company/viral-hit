import test from 'node:test';
import assert from 'node:assert/strict';
import { characterSwapPrompt, swapDuration, swapSegments, swapVerdict } from './contract';

test('a clip becomes even pieces of 2 to 15 seconds in source time', () => {
  assert.deepEqual(swapSegments(1, 12), [{ start: 1, duration: 12 }]);
  assert.deepEqual(swapSegments(0, 31), [{ start: 0, duration: 10.333 }, { start: 10.333, duration: 10.333 }, { start: 20.667, duration: 10.333 }]);
  assert.deepEqual(swapSegments(4, 15), [{ start: 4, duration: 15 }]);
  assert.throws(() => swapSegments(0, 1.5), /at least 2 seconds/);
  assert.throws(() => swapSegments(0, 121), /at most 120 seconds/);
});

test('the requested length covers the piece with the shortest supported length', () => {
  assert.equal(swapDuration(3.2, ['5s', '6s', '10s']), '5s');
  assert.equal(swapDuration(6, ['5s', '6s', '10s']), '6s');
  assert.equal(swapDuration(12, ['5s', '10s']), '10s');
  assert.equal(swapDuration(4, null), null);
});

test('the prompt assigns identity to the images and everything else to the video', () => {
  const prompt = characterSwapPrompt('She keeps the red scarf.', 2);
  assert.match(prompt, /^Replace the person in the reference video with the character from the reference images\./);
  assert.match(prompt, /body movement, head turns, facial expressions, gaze, acting timing, camera movement, framing, background and lighting/);
  assert.match(prompt, /She keeps the red scarf\.$/);
});

test('face similarity decides whether the swap took, mixed both people or kept the original', () => {
  assert.equal(swapVerdict(0.62, 0.12), 'swapped');
  assert.equal(swapVerdict(0.5, 0.45), 'blended');
  assert.equal(swapVerdict(0.2, 0.7), 'kept');
  assert.equal(swapVerdict(0.2, 0.1), 'unclear');
  assert.equal(swapVerdict(null, null), 'unclear');
  assert.equal(swapVerdict(0.5, null), 'swapped');
});
