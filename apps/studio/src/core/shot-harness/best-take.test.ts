import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBestTake } from './best-take';
import { faceSampleTimes, summarizeFaceFrames } from '../characters/face-match';

test('a take that shows a different face loses to a cleaner match unless every take fails', () => {
  const takes = [{ assetId: 'sharp', score: 92, face: 'different' as const }, { assetId: 'kept', score: 80, face: 'mixed' as const }, { assetId: 'unchecked', score: 70, face: null }];
  assert.equal(pickBestTake(takes)?.assetId, 'kept');
  assert.equal(pickBestTake(takes.map(take => ({ ...take, face: 'different' as const })))?.assetId, 'sharp');
  assert.equal(pickBestTake([]), null);
});

test('frame similarities reduce to match, drift, different or no face', () => {
  const frames = (values: (number | null)[]) => values.map((similarity, index) => ({ time: index, faces: similarity === null ? 0 : 1, similarity }));
  assert.deepEqual(summarizeFaceFrames(frames([0.8, 0.22, 0.41, 0.4, 0.36, 0.35, 0.26])), { status: 'mixed', similarity: 0.36, matchedFrames: 3, facedFrames: 7, lowest: { time: 1, similarity: 0.22 } });
  assert.equal(summarizeFaceFrames(frames([0.5, 0.45, 0.33, 0.6])).status, 'match');
  assert.equal(summarizeFaceFrames(frames([0.2, 0.1, null])).status, 'different');
  assert.equal(summarizeFaceFrames(frames([null, null])).status, 'no-face');
  assert.deepEqual(faceSampleTimes(6.04, 8), [0.431, 1.294, 2.157, 3.02, 3.883, 4.746, 5.609]);
  assert.deepEqual(faceSampleTimes(0), [0]);
});
