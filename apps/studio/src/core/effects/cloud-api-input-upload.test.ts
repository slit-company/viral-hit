import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureCloudApiInputUrl } from './cloud-api-input-upload';

test('keeps official Cloud API input URLs and rehosts generated outputs', async () => {
  const inputUrl = 'https://media.cloud.example/inputs/character.png';
  assert.equal(
    await ensureCloudApiInputUrl({
      url: inputUrl,
      kind: 'image',
      baseUrl: 'https://api.cloud.example',
      apiKey: 'sk-test',
    }),
    inputUrl
  );

  const originalFetch = globalThis.fetch;
  const uploadedUrl = 'https://media.cloud.example/inputs/file_1.png';
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/outputs/')) {
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/png' },
      });
    }
    if (url.endsWith('/v1/files')) {
      return Response.json(
        { data: { id: 'file_1', url: uploadedUrl, key: 'inputs/file_1.png' } },
        { status: 201 }
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    assert.equal(
      await ensureCloudApiInputUrl({
        url: 'https://media.cloud.example/outputs/task/result.png',
        kind: 'image',
        baseUrl: 'https://api.cloud.example',
        apiKey: 'sk-test',
      }),
      uploadedUrl
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('accepts public provider URLs without requiring the official Cloud API origin', async () => {
  const publicUrl = 'https://cdn.example.com/character.png?signature=abc';
  assert.equal(
    await ensureCloudApiInputUrl({
      url: publicUrl,
      kind: 'image',
      baseUrl: 'https://api.cloud.example',
      apiKey: 'sk-test',
    }),
    publicUrl
  );
});

test('rejects private Motion Control media URLs', async () => {
  await assert.rejects(
    () =>
      ensureCloudApiInputUrl({
        url: 'http://127.0.0.1/character.png',
        kind: 'image',
        baseUrl: 'https://api.cloud.example',
        apiKey: 'sk-test',
      }),
    /public HTTP\(S\) URLs/
  );
});
