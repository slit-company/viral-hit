import test from 'node:test';
import assert from 'node:assert/strict';
import { openPublicImageHost, publicImageHostConfig, publicImageUrl } from './public-image-host.server';

const config = publicImageHostConfig({ R2_ENDPOINT: 'https://account.r2.example.com', R2_ACCESS_KEY_ID: 'fixture-access', R2_SECRET_ACCESS_KEY: 'fixture-secret', R2_BUCKET_NAME: 'studio-media', R2_PUBLIC_URL: 'https://media.example.com/' })!;
const image = { sha256: 'd'.repeat(64), sizeBytes: 5 };
const signal = () => AbortSignal.timeout(10000);

test('only complete HTTPS storage with a public base URL can host Instagram images', () => {
  assert.deepEqual(config, { region: 'auto', endpoint: 'https://account.r2.example.com', accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret', bucketName: 'studio-media', publicUrl: 'https://media.example.com' });
  assert.equal(publicImageUrl(config, image.sha256), `https://media.example.com/instagram/${'d'.repeat(64)}.jpg`);
  const complete = { R2_ENDPOINT: 'https://account.r2.example.com', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'b', R2_BUCKET_NAME: 'studio-media', R2_PUBLIC_URL: 'https://media.example.com' };
  for (const change of [{ R2_PUBLIC_URL: undefined }, { R2_PUBLIC_URL: 'http://media.example.com' }, { R2_PUBLIC_URL: 'https://127.0.0.1' }, { R2_ENDPOINT: 'https://localhost:9000' }, { R2_BUCKET_NAME: 'Bad_Bucket' }, { R2_SECRET_ACCESS_KEY: '' }]) assert.equal(publicImageHostConfig({ ...complete, ...change }), null);
  assert.throws(() => publicImageUrl(config, '../escape'));
});

test('publishing uploads once with a signed PUT, verifies the public copy and reuses an identical object', async () => {
  let stored: Uint8Array | null = null;
  const calls: { method: string; url: string; type: string | null; signed: boolean }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input), method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    calls.push({ method, url, type: headers.get('content-type'), signed: /^AWS4-HMAC-SHA256 /.test(headers.get('authorization') ?? '') });
    if (method === 'HEAD') return stored ? new Response(null, { status: 200, headers: { 'content-length': String(stored.length), 'content-type': 'image/jpeg' } }) : new Response(null, { status: 404 });
    if (method === 'PUT') { stored = new Uint8Array(await new Response(init?.body ?? null).arrayBuffer()); return new Response(null, { status: 200 }); }
    throw new Error('Unexpected request');
  };
  const host = openPublicImageHost({ fetch: request, config: async () => config });
  assert.equal(await host.verify(image, signal()), null);
  const target = `https://media.example.com/instagram/${image.sha256}.jpg`;
  assert.equal(await host.publish(image, async () => new Uint8Array([1, 2, 3, 4, 5]), signal()), target);
  const put = calls.find(call => call.method === 'PUT')!;
  assert.equal(put.url, `https://account.r2.example.com/studio-media/instagram/${image.sha256}.jpg`); assert.equal(put.type, 'image/jpeg'); assert.equal(put.signed, true);
  assert.deepEqual([...stored!], [1, 2, 3, 4, 5]);
  const before = calls.length;
  assert.equal(await host.publish(image, async () => { throw new Error('An existing public copy must not be read again'); }, signal()), target);
  assert.deepEqual(calls.slice(before).map(call => call.method), ['HEAD']);
  assert.equal(await host.verify(image, signal()), target);
  assert.equal(await host.verify({ ...image, sizeBytes: 6 }, signal()), null);
  assert.equal(await openPublicImageHost({ fetch: request, config: async () => null }).configured(), false);
});
