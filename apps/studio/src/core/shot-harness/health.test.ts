import assert from 'node:assert/strict';
import test from 'node:test';
import { serviceHealth } from './health';

test('the latest outcome per service decides: credit failures sink, successes lift', () => {
  const health = serviceHealth([
    { modelId: 'hf-video', providerId: 'higgsfield', succeeded: false, error: 'Your credit balance is too low to complete this request', at: 3 },
    { modelId: 'hf-image', providerId: 'higgsfield', succeeded: true, error: null, at: 1 },
    { modelId: 'grok', providerId: 'xai', succeeded: true, error: null, at: 2 },
    { modelId: 'flux', providerId: 'fal', succeeded: false, error: 'content policy', at: 4 },
  ]);
  assert.deepEqual(Object.fromEntries(health), { higgsfield: { score: -30, reason: 'ran out of credit on its last run', outOfCredit: true }, xai: { score: 3, reason: 'worked recently' } });
});
