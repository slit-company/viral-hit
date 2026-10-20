import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./cloud-api.ts', import.meta.url), 'utf8');

test('Cloud API settings accept only a key and test the operator-configured endpoint', () => {
  assert.match(source, /validateTrustedLocalJsonMutation/);
  assert.match(source, /const baseUrl = getCloudApiBaseUrl\(\)/);
  assert.match(source, /\$\{baseUrl\}\/v1\/usage/);
  assert.doesNotMatch(source, /body\.baseUrl/);
  assert.doesNotMatch(source, /CLOUD_API_BASE_URL/);
});
