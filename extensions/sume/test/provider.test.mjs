import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneration, checkStatus, testConnection } from '../src/provider.mjs';
import { profiles, providerManifest } from '../src/profiles.mjs';
import { buildPayload } from '../src/payload.mjs';
import { client, limitedJson } from '../src/client.mjs';
const signal = () => AbortSignal.timeout(10000), configuration = { SUME_API_KEY: 'fixture-key-not-a-real-credential' };
const json = (data, status = 200, headers = {}) => Response.json({ data }, { status, headers });
const model = { id: 'sume-gpt-image-2', kind: 'image' };
const input = { prompt: 'A blue circle', aspectRatio: '1:1', imageUrls: ['owned:one', 'owned:one'] };
async function mock(handler, run) { const original = globalThis.fetch; globalThis.fetch = handler; try { return await run(); } finally { globalThis.fetch = original; } }
function catalog(id = 'gpt-image-2') { return { model: { id, capabilities: { image_edit: true, aspect_ratios: ['1:1'], qualities: ['medium'] } } }; }

test('all 30 profiles build bounded explicit request bodies; video transforms omit unsupported prompt/aspect', () => {
  assert.equal(providerManifest().models.length, 30);
  for (const profile of profiles) {
    const refs = Object.fromEntries(Object.entries(profile.referenceInputs).map(([kind, value]) => [kind + 'Urls', Array.from({ length: value.min }, (_, i) => kind + i)]));
    const { body, path } = buildPayload(profile, { prompt: 'Test script', ...refs, ...(profile.route === 'speech' ? { options: { voice_id: 'voi_' + 'a'.repeat(32) } } : {}) });
    assert.match(path, /^\/v1\//); assert.equal(body.mode, 'async');
    if (['lipsync', 'dubbing', 'upscale', 'captions'].includes(profile.route)) { assert.equal(body.prompt, undefined); assert.equal(body.aspect_ratio, undefined); }
    if (profile.route === 'restyle') assert.equal(body.image_urls, undefined);
    if (profile.route === 'music') assert.equal(body.duration, undefined);
  }
  assert.throws(() => buildPayload(profiles.find(p => p.route === 'captions'), { videoUrls: ['owned:v'], options: { style: 'slam', language: 'ko' } }), /Hangul/);
  assert.throws(() => buildPayload(profiles[0], { ...input, options: { arbitrary: true } }), /Invalid/);
});

test('local upload is deduplicated, credential never forwarded, generation gets durable idempotency key', async () => {
  const calls = []; let reads = 0;
  await mock(async (url, init) => {
    url = String(url); calls.push({ url, init });
    if (url.endsWith('/models/gpt-image-2')) return json(catalog());
    if (url.endsWith('/generate-upload-url')) return json({ public_url: 'https://media.sume.com/assets/one.png', upload_url: 'https://fixture.r2.cloudflarestorage.com/object?signature=fake', upload_method: 'PUT', upload_headers: { 'content-type': 'image/png', 'content-length': '3' } });
    if (url.includes('r2.cloudflarestorage.com')) { assert.equal(new Headers(init.headers).get('authorization'), null); assert.equal(init.redirect, 'error'); return new Response(null, { status: 200 }); }
    assert.match(init.headers['Idempotency-Key'], /^vh-[a-f0-9]{64}$/); assert.equal(init.headers.Authorization, 'Bearer ' + configuration.SUME_API_KEY);
    assert.deepEqual(JSON.parse(init.body).image_urls, ['https://media.sume.com/assets/one.png', 'https://media.sume.com/assets/one.png']);
    return json({ job: { id: 'job_upload' } }, 202);
  }, async () => {
    assert.deepEqual(await createGeneration({ model, input, configuration, signal: signal(), requestKey: 'durable-generation-1', readMedia: async () => { reads++; return { bytes: new Uint8Array([1, 2, 3]), kind: 'image', mimeType: 'image/png' }; } }), { status: 'processing', taskId: 'job_upload', cost: { state: 'unknown', final: false } });
  });
  assert.equal(reads, 1); assert.equal(calls.length, 4);
});

test('uncertain submission is sent once and prompts reconciliation, never automatic paid retry', async () => {
  let posts = 0;
  await mock(async (url, init) => { if (init.method === 'GET') return json(catalog()); posts++; throw Error('network reset'); }, async () => {
    await assert.rejects(createGeneration({ model, input: { ...input, imageUrls: [] }, configuration, requestKey: 'fixed-id', signal: signal() }), /outcome is unknown/);
  });
  assert.equal(posts, 1);
});

test('changed catalog constraints reject before upload; signed uploads cannot target private hosts', async () => {
  let calls = 0;
  await mock(async () => { calls++; return json({ model: { id: 'gpt-image-2', capabilities: { aspect_ratios: ['16:9'] } } }); }, async () => {
    await assert.rejects(createGeneration({ model, input, configuration, requestKey: 'fixed-id', signal: signal() }), /aspect_ratio/);
  }); assert.equal(calls, 1);
  await mock(async () => json({ public_url: 'https://media.sume.com/a', upload_url: 'https://127.0.0.1/internal', upload_method: 'PUT' }), async () => {
    await assert.rejects(client(configuration, signal()).upload('owned:x', async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' })), /destination/);
  });
});

test('polling survives reload, respects Retry-After, handles failure and validates output hosts', async () => {
  const originalNow = Date.now; let now = originalNow(), calls = 0; Date.now = () => now;
  try {
    await mock(async url => { calls++; if (calls === 1) return Response.json({ error: { code: 'rate_limited' } }, { status: 429, headers: { 'retry-after': '10' } }); if (String(url).endsWith('/status')) return json({ status: 'COMPLETED', result_ready: true }); return json({ result: { artifacts: [{ type: 'image', url: 'https://media.sume.com/result.png' }] } }); }, async () => {
      const args = { model, taskId: 'job_recovered_after_restart', configuration, signal: signal() };
      assert.equal((await checkStatus(args)).status, 'processing');
      assert.equal((await checkStatus(args)).status, 'processing'); assert.equal(calls, 1);
      now += 10001;
      assert.deepEqual((await checkStatus(args)).media, [{ url: 'https://media.sume.com/result.png' }]); assert.equal(calls, 3);
    });
    await mock(async url => String(url).endsWith('/status') ? json({ sume_status: 'completed' }) : json({ result: { artifacts: [{ type: 'image', url: 'https://evil.example/result.png' }] } }), async () => { await assert.rejects(checkStatus({ model, taskId: 'job_badhost', configuration, signal: signal() }), /media host/); });
    await mock(async () => json({ sume_status: 'failed' }), async () => { assert.equal((await checkStatus({ model, taskId: 'job_failed', configuration, signal: signal() })).status, 'failed'); });
  } finally { Date.now = originalNow; }
});

test('connection check is read-only; oversized data and upstream secret-bearing errors are bounded', async () => {
  await mock(async (url, init) => { assert.equal(String(url), 'https://api.sume.com/v1/open/balance'); assert.equal(init.method, 'GET'); return json({ balance: 0 }); }, async () => assert.equal((await testConnection({ configuration, signal: signal() })).ok, true));
  await assert.rejects(limitedJson(new Response('x'.repeat(2_000_001))), /2 MB/);
  await mock(async () => Response.json({ error: { code: 'unauthorized', message: configuration.SUME_API_KEY } }, { status: 401 }), async () => {
    await assert.rejects(testConnection({ configuration, signal: signal() }), error => !error.message.includes(configuration.SUME_API_KEY) && /401/.test(error.message));
  });
});

test('billing preserves reservation/capture/refund amounts without assuming zero for missing fields', async () => {
  const { reportedCost } = await import('../src/cost.mjs');
  assert.deepEqual(reportedCost({}), { state: 'unknown', final: false });
  assert.deepEqual(reportedCost({ usage: { credits: 12, usd: '0.10' } }), { state: 'reserved', final: false, unit: 'credits', reserved: 12, usdCents: { reserved: 10 } });
  assert.deepEqual(reportedCost({ job: { usage_summary: { status: 'refunded', final: true, reserved_credits: 12, captured_credits: 0, refunded_credits: 12, reserved_usd_cents: 10, metadata: 'never copy' } } }), { state: 'refunded', final: true, unit: 'credits', reserved: 12, captured: 0, refunded: 12, usdCents: { reserved: 10 } });
});
