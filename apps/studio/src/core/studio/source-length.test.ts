import test from 'node:test';
import assert from 'node:assert/strict';
import { coveringDuration, fitToSourceVideo } from './source-length';
import type { ModelControl } from '../generation-providers/model-controls';

test('a source-following model gets a length that covers the clip and its source length option', () => {
  assert.equal(coveringDuration(3.2, ['5s', '6s', '10s']), '5s');
  assert.equal(coveringDuration(6.02, ['5s', '6s', '10s']), '6s');
  assert.equal(coveringDuration(12, ['5s', '10s']), '10s');
  assert.equal(coveringDuration(4, null), null);
  const controls: ModelControl[] = [{ key: 'source_seconds', label: 'Source length', type: 'number', default: 5, min: 2, max: 60 }];
  assert.deepEqual(fitToSourceVideo(6.04, { id: 'lipsync', controls }, {}), { modelOptions: { modelId: 'lipsync', values: { source_seconds: 7 } } });
  assert.deepEqual(fitToSourceVideo(6.04, { id: 'edit', supportedDurations: ['5s', '10s'] }, { duration: '5s' }), { duration: '10s' });
  // Already fitted: nothing to change, so a later choice by the person stays.
  assert.equal(fitToSourceVideo(6.04, { id: 'lipsync', controls }, { modelOptions: { modelId: 'lipsync', values: { source_seconds: 7 } } }), null);
  assert.deepEqual(fitToSourceVideo(90, { id: 'lipsync', controls }, { modelOptions: { modelId: 'other', values: { x: 1 } } }), { modelOptions: { modelId: 'lipsync', values: { source_seconds: 60 } } });
});
