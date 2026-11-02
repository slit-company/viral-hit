import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getGenerationPromptConstraints,
  getGenerationPromptMaxChars,
  validateGenerationPrompt,
} from './validation';

test('prompt constraints follow the public Cloud API model contract', () => {
  assert.deepEqual(getGenerationPromptConstraints({ modelId: 'seedance-2' }), {
    required: true,
    maxChars: 5000,
    accepted: true,
  });
  assert.deepEqual(
    getGenerationPromptConstraints({ modelId: 'kling-3-motion-control' }),
    { required: false, maxChars: 2500, accepted: true }
  );
  assert.equal(
    getGenerationPromptMaxChars({ modelId: 'video-analysis' }),
    12000
  );
  assert.equal(
    getGenerationPromptMaxChars({ modelId: 'grok-imagine-video-1.5' }),
    4096
  );
});

test('a declared prompt input makes the prompt optional or drops it', () => {
  assert.deepEqual(getGenerationPromptConstraints({ modelId: 'any', promptInput: 'optional' }), { required: false, maxChars: 5000, accepted: true });
  const none = getGenerationPromptConstraints({ modelId: 'any', promptInput: 'none' });
  assert.deepEqual(none, { required: false, maxChars: 0, accepted: false });
  // A stale prompt never blocks or reaches a model that ignores prompt text.
  assert.deepEqual(validateGenerationPrompt('left over from another model', none), { ok: true, trimmedPrompt: '', charCount: 0 });
  assert.equal(validateGenerationPrompt('', getGenerationPromptConstraints({ promptInput: 'optional' })).ok, true);
  assert.equal(validateGenerationPrompt('', getGenerationPromptConstraints({})).ok, false);
});
