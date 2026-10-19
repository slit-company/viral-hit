import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CLOUD_API_BASE_URL,
  getCreativeCanvasProviderPublicConfig,
  getCreativeCanvasProviderServerConfig,
  isOfficialCloudApiBaseUrl,
  resolveCreativeCanvasProviderId,
} from './provider-config';

test('Cloud API is the default CreativeCanvas generation provider', () => {
  assert.equal(resolveCreativeCanvasProviderId(undefined), 'cloud-api');
  assert.deepEqual(getCreativeCanvasProviderPublicConfig(undefined), {
    id: 'cloud-api',
    label: 'Cloud API',
    isDefault: true,
    supports: ['image', 'video', 'analysis'],
  });
});

test('default server config points to the production Cloud API endpoint', () => {
  assert.equal(
    getCreativeCanvasProviderServerConfig().baseUrl,
    DEFAULT_CLOUD_API_BASE_URL
  );
  assert.equal(
    getCreativeCanvasProviderServerConfig({
      baseUrl: 'https://attacker.example',
      apiKey: 'sk-test',
    }).baseUrl,
    DEFAULT_CLOUD_API_BASE_URL
  );
});

test('managed storage eligibility is limited to the official Cloud API billing endpoint', () => {
  assert.equal(isOfficialCloudApiBaseUrl(undefined), true);
  assert.equal(isOfficialCloudApiBaseUrl('https://api.cloud.example/'), true);
  assert.equal(isOfficialCloudApiBaseUrl('https://api.cloud.example/v1'), false);
  assert.equal(isOfficialCloudApiBaseUrl('https://api.cloud.example.example.com'), false);
  assert.equal(isOfficialCloudApiBaseUrl('https://provider.example.com'), false);
  assert.equal(isOfficialCloudApiBaseUrl('not-a-url'), false);
});
