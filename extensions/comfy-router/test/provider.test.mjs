import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneration, checkStatus, testConnection } from '../src/provider.mjs';
import { profiles, buildBody, checkInput, profileFor } from '../src/profiles.mjs';
import { providerManifest } from '../src/profiles.mjs';
const configuration = { COMFY_API_KEY: 'comfyui-fixture-not-a-real-key' };
const base = { configuration, signal: AbortSignal.timeout(20000), requestKey: 'persisted-generation-id' };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
async function mock(handler, run) { const original = globalThis.fetch; globalThis.fetch = handler; try { await run(); } finally { globalThis.fetch = original; } }
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });

test('every model builds the documented native Router body', () => {
  assert.equal(providerManifest().models.length, 5);
  const body = id => { const profile = profileFor(id); return buildBody(profile, checkInput(profile, { prompt: 'Neon street', aspectRatio: '9:16' }), []); };
  assert.deepEqual(body('comfy-flux-3-image'), { prompt: 'Neon street', aspect_ratio: '9:16', resolution: '1k', grounding: false });
  assert.equal(body('comfy-flux-3-video').mode, 't2v');
  assert.equal(body('comfy-ltx-2-5-pro').resolution, '1080x1920');
  assert.equal(body('comfy-ltx-2-5-fast').fps, 25);
  const h3 = body('comfy-minimax-h3');
  assert.deepEqual(h3.content, [{ type: 'text', text: 'Neon street' }]); assert.equal(h3.ratio, '9:16'); assert.equal(h3.duration, 6);
  const flux = profileFor('comfy-flux-3-video');
  assert.equal(buildBody(flux, checkInput(flux, { prompt: 'p', imageUrls: ['owned:a'] }), [{ base64: 'QUJD', mimeType: 'image/png' }]).mode, 'i2v');
  const minimax = profileFor('comfy-minimax-h3');
  const frames = buildBody(minimax, checkInput(minimax, { prompt: 'p', imageUrls: ['a', 'b'] }), [{ base64: 'QQ==', mimeType: 'image/png' }, { base64: 'Qg==', mimeType: 'image/jpeg' }]);
  assert.deepEqual(frames.content.slice(1).map(item => item.role), ['first_frame', 'last_frame']);
  assert.equal(frames.ratio, 'adaptive');
  assert.throws(() => checkInput(profileFor('comfy-ltx-2-5-pro'), { prompt: 'p', imageUrls: ['a'] }), /reference count/);
  assert.throws(() => checkInput(profileFor('comfy-flux-3-image'), { prompt: 'p', options: { resolution: '8k' } }), /Invalid/);
});

test('queued submit uses the Comfy key, a stable idempotency key and inline reference bytes', async () => {
  const keys = [];
  await mock(async (url, init) => {
    assert.equal(url, 'https://api.comfy.org/v2/models/bfl/flux-3-image/requests');
    assert.equal(init.headers.Authorization, 'Bearer ' + configuration.COMFY_API_KEY);
    keys.push(init.headers['Idempotency-Key']);
    assert.deepEqual(JSON.parse(init.body).images, [Buffer.from(PNG).toString('base64')]);
    return json({ request_id: 'req_123', status: 'IN_QUEUE' }, 202);
  }, async () => {
    const model = profileFor('comfy-flux-3-image');
    for (let i = 0; i < 2; i++) {
      const result = await createGeneration({ ...base, model, input: { prompt: 'Edit it', imageUrls: ['owned:x'] }, readMedia: async () => ({ bytes: PNG, mimeType: 'image/png' }) });
      assert.equal(result.status, 'processing'); assert.equal(result.taskId, 'q:req_123');
    }
  });
  assert.equal(keys[0], keys[1]); assert.match(keys[0], /^vh-[a-f0-9]{48}$/);
});

test('polling waits, collects the native result, downloads it and keeps credentials off the media host', async () => {
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  const model = profileFor('comfy-ltx-2-5-fast'); let state = 'IN_PROGRESS';
  try {
    await mock(async (url, init) => {
      url = String(url);
      if (url.endsWith('/status')) return json({ status: state }, 200, { 'retry-after': '5' });
      if (url.endsWith('/requests/req_v')) return json({ status: 'completed', result: { video_url: 'https://storage.example.com/out.mp4' } });
      assert.equal(new Headers(init?.headers).get('authorization'), null);
      return new Response(MP4, { headers: { 'content-type': 'video/mp4' } });
    }, async () => {
      assert.equal((await checkStatus({ ...base, model, taskId: 'q:req_v' })).status, 'processing');
      state = 'COMPLETED';
      assert.equal((await checkStatus({ ...base, model, taskId: 'q:req_v' })).status, 'processing');
      now += 5001;
      const done = await checkStatus({ ...base, model, taskId: 'q:req_v' });
      assert.equal(done.status, 'succeeded'); assert.equal(done.media[0].mimeType, 'video/mp4');
    });
  } finally { Date.now = originalNow; }
});

test('completion errors, rejected requests and private media URLs fail without retry loops', async () => {
  const model = profileFor('comfy-minimax-h3');
  await mock(async () => json({ status: 'COMPLETED', error_type: 'content_policy_violation' }), async () => {
    const result = await checkStatus({ ...base, model, taskId: 'q:req_a' });
    assert.equal(result.status, 'failed'); assert.match(result.error, /content_policy_violation/);
  });
  await mock(async () => new Response(null, { status: 402, headers: { 'x-comfy-error-type': 'insufficient_credits' } }), async () => {
    assert.equal((await checkStatus({ ...base, model, taskId: 'q:req_b' })).status, 'failed');
  });
  await mock(async url => String(url).endsWith('/status') ? json({ status: 'COMPLETED' }) : json({ task: { status: 'succeeded', content: { url: 'https://127.0.0.1/private.mp4' } } }), async () => {
    await assert.rejects(checkStatus({ ...base, model, taskId: 'q:req_c' }), /unsupported media URL/);
  });
});

test('an account without the queue runs synchronously and collects a timeout with the same key', async () => {
  const model = profileFor('comfy-flux-3-image'); const sync = []; let call = 0;
  await mock(async (url, init) => {
    url = String(url);
    if (url.endsWith('/requests')) return new Response(null, { status: 403, headers: { 'x-comfy-error-type': 'not_enabled' } });
    if (url === 'https://api.comfy.org/v2/models/bfl/flux-3-image') { sync.push(init.headers['Idempotency-Key']); return ++call === 1 ? new Response(null, { status: 504, headers: { 'x-comfy-error-type': 'deadline_exceeded', 'retry-after': '2' } }) : json({ status: 'Ready', result: { sample: 'https://cdn.example.com/a.png' } }); }
    return new Response(PNG);
  }, async () => {
    const first = await createGeneration({ ...base, model, input: { prompt: 'A fox' } });
    assert.equal(first.status, 'processing');
    const originalNow = Date.now; Date.now = () => originalNow() + 3000;
    try { assert.equal((await checkStatus({ ...base, model, taskId: first.taskId })).status, 'succeeded'); } finally { Date.now = originalNow; }
  });
  assert.equal(sync.length, 2); assert.equal(sync[0], sync[1]);
});

test('connection check is a read-only catalog request', async () => {
  await mock(async (url, init) => { assert.equal(init.method, 'GET'); assert.match(String(url), /\/v2\/models\?limit=1$/); return json({ data: [] }); }, () => testConnection(base));
});
