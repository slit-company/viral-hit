import test from 'node:test';
import assert from 'node:assert/strict';
import { bestVariation, shapeshiftPrompt, shapeshiftRequest, shapeshiftScore, splitSource } from './contract';

test('a source becomes even pieces no longer than the model makes in one go', () => {
  assert.deepEqual(splitSource(0, 6.042, 10), [{ start: 0, duration: 6.042 }]);
  assert.deepEqual(splitSource(2, 31, 15), [{ start: 2, duration: 10.333 }, { start: 12.333, duration: 10.333 }, { start: 22.667, duration: 10.333 }]);
});

test('each mode tells the model which input supplies what', () => {
  assert.match(shapeshiftPrompt('object-swap', 'none', '', 1), /^Replace the main subject of the reference video with the subject from the reference image./);
  assert.match(shapeshiftPrompt('object-swap', 'none', '', 1), /Keep everything else from the reference video/);
  const transfer = shapeshiftPrompt('motion-transfer', 'claymation', 'On a rooftop at dusk.', 3);
  assert.match(transfer, /^Create a new video of the character from the reference images performing exactly the motion/);
  assert.match(transfer, /claymation look/);
  assert.match(transfer, /On a rooftop at dusk.$/);
});

test('the score rewards following motion and the new face, and costs points when the old face remains', () => {
  assert.equal(shapeshiftScore({ motion: 0.8, character: null, source: null }), 0.8);
  assert.equal(shapeshiftScore({ motion: 0.8, character: 0.6, source: 0.1 }), 0.9);
  assert.ok(shapeshiftScore({ motion: 0.8, character: 0.6, source: 0.5 }) < shapeshiftScore({ motion: 0.8, character: 0.6, source: 0.1 }));
  assert.equal(bestVariation([0.4, null, 0.7, 0.7]), 2);
  assert.equal(bestVariation([null, null]), -1);
});

test('a run needs a subject and a forward range', () => {
  const base = { action: 'plan', mode: 'object-swap', sourceAssetId: 'clip' } as const;
  assert.equal(shapeshiftRequest.safeParse(base).success, false);
  assert.equal(shapeshiftRequest.safeParse({ ...base, characterId: 'mina', start: 4, end: 2 }).success, false);
  const parsed = shapeshiftRequest.parse({ ...base, imageAssetIds: ['face'] });
  assert.deepEqual([parsed.action === 'plan' && parsed.modelId, parsed.action === 'plan' && parsed.variations], ['auto', 1]);
});
