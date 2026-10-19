import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isOfficialCloudApiInputUrl,
  isOfficialCloudApiMediaUrl,
  isPublicHttpMediaUrl,
} from './cloud-api-media-url';

test('accepts arbitrary public provider media URLs without requiring an official path', () => {
  for (const url of [
    'https://cdn.example.com/custom/result.mp4?signature=abc&expires=123',
    'http://media.example.org/files/result.png#preview',
    'https://8.8.8.8:8443/output.webm',
  ]) {
    assert.equal(isPublicHttpMediaUrl(url), true, url);
  }

  for (const url of [
    'file:///tmp/result.mp4',
    'javascript:alert(1)',
    'https://user:pass@cdn.example.com/result.mp4',
    'http://localhost/result.mp4',
    'https://127.0.0.1/result.mp4',
    'https://10.1.2.3/result.mp4',
    'https://203.0.113.10/result.mp4',
    'https://[::1]/result.mp4',
    'https://[::ffff:127.0.0.1]/result.mp4',
  ]) {
    assert.equal(isPublicHttpMediaUrl(url), false, url);
  }
});

test('allows only the official Cloud API media origin', () => {
  assert.equal(
    isOfficialCloudApiMediaUrl(
      'https://media.cloud.example/outputs/task_123/result.mp4'
    ),
    true
  );

  for (const url of [
    'http://media.cloud.example/output.mp4',
    'https://media.cloud.example.evil.example/output.mp4',
    'https://127.0.0.1/output.mp4',
    'https://media.cloud.example:8443/output.mp4',
    'https://user:pass@media.cloud.example/output.mp4',
    'not-a-url',
  ]) {
    assert.equal(isOfficialCloudApiMediaUrl(url), false, url);
  }
});

test('treats only /inputs/ objects as Cloud API input files', () => {
  assert.equal(
    isOfficialCloudApiInputUrl('https://media.cloud.example/inputs/character.png'),
    true
  );
  assert.equal(
    isOfficialCloudApiInputUrl(
      'https://media.cloud.example/outputs/task_123/result.png'
    ),
    false
  );
});
