import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCreativeCanvasProviderPublicConfig,
  getCreativeCanvasProviderServerConfig,
  normalizeCloudApiBaseUrl,
  resolveCreativeCanvasProviderId,
} from './provider-config';
import { getCloudApiBaseUrl, requireCloudApiBaseUrl } from '@/core/generation-providers/cloud-api-endpoint.server';

test('Cloud API is the default CreativeCanvas generation provider', () => {
  assert.equal(resolveCreativeCanvasProviderId(undefined), 'cloud-api');
  assert.deepEqual(getCreativeCanvasProviderPublicConfig(undefined), {
    id: 'cloud-api',
    label: 'Cloud API',
    isDefault: true,
    supports: ['image', 'video', 'analysis'],
  });
});

test('endpoints must be HTTPS origins without credentials, query or fragment', () => {
  assert.equal(normalizeCloudApiBaseUrl('https://api.example.com/'), 'https://api.example.com');
  assert.equal(normalizeCloudApiBaseUrl(' https://api.example.com/v2/ '), 'https://api.example.com/v2');
  assert.equal(normalizeCloudApiBaseUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  for (const value of [undefined, '', 'not-a-url', 'http://api.example.com', 'https://user:pass@api.example.com',
    'https://api.example.com/?key=1', 'https://api.example.com/#x', 'ftp://api.example.com']) {
    assert.equal(normalizeCloudApiBaseUrl(value), null, String(value));
  }
  assert.equal(getCreativeCanvasProviderServerConfig({ baseUrl: 'http://attacker.example', apiKey: 'sk' }).baseUrl, '');
});

test('the server endpoint comes only from operator environment', () => {
  assert.equal(getCloudApiBaseUrl({ VIRAL_HIT_CLOUD_API_URL: 'https://api.example.com/' }), 'https://api.example.com');
  assert.equal(getCloudApiBaseUrl({}), null);
  assert.throws(() => requireCloudApiBaseUrl({}), /VIRAL_HIT_CLOUD_API_URL/);
});
