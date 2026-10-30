import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneration, checkStatus, testConnection } from '../src/provider.mjs';
import { profiles, buildPayload } from '../src/profiles.mjs';
import { client, limitedJson } from '../src/client.mjs';
const configuration = { HIGGSFIELD_API_KEY: 'fixture-id:fixture-secret' };
const id = 'ea25f1f1-d1dd-4abb-aaaa-123456789012';
const taskId = 'https://api.higgsfield.ai/requests/' + id + '/status';
const image = profiles[0], video = profiles[1], motion = profiles[2];
const base = { configuration, signal: AbortSignal.timeout(20000), requestKey: 'persisted-generation-id' };
async function mock(handler, run) { const original = globalThis.fetch; globalThis.fetch = handler; try { await run(); } finally { globalThis.fetch = original; } }

test('catalog maps documented model-specific input and rejects invalid options before network access', () => {
  assert.equal(buildPayload(image, { prompt: 'Blue vase' }).batch_size, 1);
  const payload = buildPayload(video, { prompt: 'Blue vase', duration: '8s', options: { generate_audio: false } });
  assert.equal(payload.duration, 8); assert.equal(payload.generate_audio, false);
  const remix = buildPayload(motion, { prompt: 'Keep the gesture', imageUrls: ['owned:i'], videoUrls: ['owned:v'], aspectRatio: 'auto' });
  assert.equal(remix.aspect_ratio, undefined); assert.equal(remix.duration, undefined);
  assert.throws(() => buildPayload(image, { prompt: 'test', options: { resolution: '8k' } }), /Invalid/);
  assert.throws(() => buildPayload(image, { prompt: 'test', imageUrls: ['owned:i'] }), /count/);
  assert.throws(() => buildPayload(motion, { prompt: 'test' }), /count/);
});

test('submission uses direct Higgsfield auth, stable idempotency and the returned status URL', async () => {
  await mock(async (url, init) => {
    assert.equal(url, 'https://api.higgsfield.ai/' + image.upstreamModelId);
    assert.equal(init.headers.Authorization, 'Key fixture-id:fixture-secret');
    assert.match(init.headers['Idempotency-Key'], /^vh-[a-f\d]{64}$/);
    assert.equal(init.redirect, 'error');
    assert.equal(JSON.parse(init.body).prompt, 'Blue vase');
    return Response.json({ request_id: id, status_url: taskId, status: 'queued' });
  }, async () => {
    const result = await createGeneration({ ...base, model: image, input: { prompt: 'Blue vase' } });
    assert.deepEqual(result, { status: 'processing', taskId, cost: { state: 'unknown', final: false } });
  });
});

test('reference uploads preserve signed headers and never forward API credentials to storage', async () => {
  let uploads = 0;
  await mock(async (url, init) => {
    if (String(url).endsWith('/files/generate-upload-url')) return Response.json({ public_url: 'https://d28lhcrx5qdowv.cloudfront.net/input.png', upload_url: 'https://higgsfield-fixture.s3.us-east-1.amazonaws.com/input?signature=fake', upload_headers: { 'Content-Type': 'image/png', 'x-amz-tagging': 'retention=temporary' } });
    uploads++; assert.equal(new Headers(init.headers).get('authorization'), null);
    assert.equal(new Headers(init.headers).get('x-amz-tagging'), 'retention=temporary');
    assert.equal(init.method, 'PUT'); assert.equal(init.redirect, 'error');
    return new Response(null, { status: 200 });
  }, async () => {
    assert.equal(await client(configuration, base.signal).upload('owned:input', async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' })), 'https://d28lhcrx5qdowv.cloudfront.net/input.png');
  });
  assert.equal(uploads, 1);
});

test('unknown paid submission is never retried, and error bodies cannot expose credentials', async () => {
  let count = 0;
  await mock(async () => { count++; throw Error(configuration.HIGGSFIELD_API_KEY); }, async () => {
    await assert.rejects(createGeneration({ ...base, model: video, input: { prompt: 'test' } }), error => /outcome is unknown/.test(error.message) && !error.message.includes('fixture-secret'));
  }); assert.equal(count, 1);
  await mock(async () => new Response(configuration.HIGGSFIELD_API_KEY, { status: 401 }), async () => {
    await assert.rejects(testConnection(base), /HTTP 401/);
  });
});

test('restarted polling checks request identity, maps terminal states and rejects untrusted output hosts', async () => {
  const recovered = taskId.replace(id, 'ba25f1f1-d1dd-4abb-aaaa-123456789012'), requestId = recovered.split('/')[4];
  await mock(async url => { assert.equal(url, recovered); return Response.json({ request_id: requestId, status: 'completed', video: { url: 'https://d28lhcrx5qdowv.cloudfront.net/out.mp4' } }); }, async () => {
    assert.deepEqual((await checkStatus({ ...base, model: video, taskId: recovered })).media, [{ url: 'https://d28lhcrx5qdowv.cloudfront.net/out.mp4' }]);
  });
  for (const status of ['failed', 'canceled', 'nsfw']) await mock(async () => Response.json({ request_id: requestId, status, error: configuration.HIGGSFIELD_API_KEY }), async () => { const result = await checkStatus({ ...base, model: video, taskId: recovered }); assert.equal(result.status, 'failed'); assert.ok(!result.error.includes('fixture-secret')); });
  await mock(async () => Response.json({ request_id: requestId, status: 'completed', images: [{ url: 'https://127.0.0.1/private' }] }), async () => {
    await assert.rejects(checkStatus({ ...base, model: image, taskId: recovered }), /media host/);
  });
  await mock(async () => { throw Error('must not fetch'); }, async () => {
    await assert.rejects(checkStatus({ ...base, model: image, taskId: 'https://evil.example/requests/' + id + '/status' }), /status URL/);
  });
});

test('polling respects Retry-After without spinning and resumes from an existing task', async () => {
  const originalNow = Date.now; let now = originalNow(), count = 0; Date.now = () => now;
  const recoveryId = 'ca25f1f1-d1dd-4abb-aaaa-123456789012', url = taskId.replace(id, recoveryId);
  try {
    await mock(async () => { count++; return count === 1 ? new Response(null, { status: 429, headers: { 'retry-after': '20' } }) : Response.json({ request_id: recoveryId, status: 'completed', images: [{ url: 'https://d28lhcrx5qdowv.cloudfront.net/out.png' }] }); }, async () => {
      const args = { ...base, model: image, taskId: url };
      assert.equal((await checkStatus(args)).status, 'processing');
      assert.equal((await checkStatus(args)).status, 'processing'); assert.equal(count, 1);
      now += 20001; assert.equal((await checkStatus(args)).status, 'succeeded'); assert.equal(count, 2);
    });
  } finally { Date.now = originalNow; }
});

test('connection test is read-only; upload origins and large response bodies are bounded', async () => {
  await mock(async (url, init) => { assert.match(url, /custom-references\/list/); assert.equal(init.method, 'GET'); return Response.json({ items: [] }); }, () => testConnection(base));
  await assert.rejects(limitedJson(new Response('x'.repeat(2_000_001))), /exceeded/);
  await mock(async () => Response.json({ public_url: 'https://d28lhcrx5qdowv.cloudfront.net/input.png', upload_url: 'https://127.0.0.1/internal' }), async () => {
    await assert.rejects(client(configuration, base.signal).upload('owned:i', async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' })), /destination/);
  });
});
