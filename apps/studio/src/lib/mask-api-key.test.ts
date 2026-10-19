import assert from 'node:assert/strict';
import test from 'node:test';

import { maskApiKeyPreview } from './mask-api-key';

test('masks a Cloud API key as a prefix preview', () => {
  assert.equal(maskApiKeyPreview('sk_examplekeyvalue'), 'sk_exampleke...');
  assert.equal(maskApiKeyPreview('short'), 'shor...');
  assert.equal(maskApiKeyPreview(''), '');
});
