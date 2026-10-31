import assert from 'node:assert/strict';
import test from 'node:test';

import { generatedAssetFilename } from './generated-asset-filename';

test('replaces a provider hash with words from the prompt', () => {
  assert.equal(
    generatedAssetFilename({ url: 'https://cdn.example/547c348845477482cfa386149154c8e4.jpg', type: 'image', prompt: 'A glossy pastel 3D play button, on a soft lime gradient' }),
    'a-glossy-pastel-3d-play-button.jpg'
  );
});

test('keeps a descriptive provider filename', () => {
  assert.equal(generatedAssetFilename({ url: 'https://cdn.example/neon-courier.mp4', type: 'video', prompt: 'ignored' }), 'neon-courier.mp4');
});

test('keeps Korean prompt words and numbers later results', () => {
  assert.equal(
    generatedAssetFilename({ url: 'https://cdn.example/output', type: 'audio', prompt: '비 오는 골목을 달리는 배달원', index: 1 }),
    '비-오는-골목을-달리는-배달원-2.wav'
  );
});

test('falls back to the media type without a prompt', () => {
  assert.equal(generatedAssetFilename({ url: 'not a url', type: 'video' }), 'generated-video.mp4');
});
