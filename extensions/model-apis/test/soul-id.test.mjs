import test from 'node:test';
import assert from 'node:assert/strict';
import { checkIdentity, createGeneration, createIdentity, manifest } from '../src/providers/higgsfield/provider.mjs';

const configuration = { HIGGSFIELD_API_KEY: 'fixture-id:fixture-secret' };
const signal = () => AbortSignal.timeout(10_000);
const ID = '0b6a3c9e-4f1d-4e2a-9c7b-5d8e1f2a3b4c';
async function mock(handler, run) { const original = globalThis.fetch; globalThis.fetch = handler; try { return await run(); } finally { globalThis.fetch = original; } }

test('a Soul ID trains from uploaded character images and reports ready or the reason it failed', async () => {
  const calls = [];
  await mock(async (url, init = {}) => {
    url = String(url); calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (url.endsWith('/files/generate-upload-url')) return Response.json({ upload_url: 'https://bucket.s3.amazonaws.com/upload?signature=fixture', public_url: 'https://cdn.higgsfield.ai/ref-' + calls.length + '.png' });
    if (url.includes('s3.amazonaws.com')) return new Response(null, { status: 200 });
    if (url.endsWith('/v1/custom-references')) return Response.json({ id: ID, name: 'Mina', status: 'queued' });
    if (url.endsWith('/v1/custom-references/' + ID)) return Response.json({ id: ID, status: calls.length > 6 ? 'failed' : 'completed', fail_reason: 'No face found' });
    throw Error('unexpected ' + url);
  }, async () => {
    const png = { bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' };
    assert.deepEqual(await createIdentity({ name: 'Mina', version: 'v2', images: [png, png], configuration, signal: signal() }), { referenceId: ID, status: 'training' });
    const created = JSON.parse(calls.find(call => call.url.endsWith('/v1/custom-references')).body);
    assert.deepEqual(created, { name: 'Mina', model_version: 'v2', input_images: [{ type: 'image_url', image_url: 'https://cdn.higgsfield.ai/ref-1.png' }, { type: 'image_url', image_url: 'https://cdn.higgsfield.ai/ref-3.png' }] });
    assert.deepEqual(await checkIdentity({ referenceId: ID, configuration, signal: signal() }), { referenceId: ID, status: 'ready' });
    assert.deepEqual(await checkIdentity({ referenceId: ID, configuration, signal: signal() }), { referenceId: ID, status: 'failed', error: 'No face found' });
  });
  await mock(async () => Response.json({ detail: 'Maximum number of concurrent requests (2) has been reached' }, { status: 429, headers: { 'retry-after': '1' } }), async () => {
    await assert.rejects(createIdentity({ name: 'Mina', version: 'v2', images: [], configuration, signal: signal() }), /already training as many Soul IDs/);
  });
  await assert.rejects(checkIdentity({ referenceId: 'not-an-id', configuration, signal: signal() }), /not a Soul ID/);
});

test('Soul models take a Soul ID of their own version, and a malformed one stops before anything is sent', async () => {
  assert.deepEqual(manifest.identityTraining.versions.map(item => item.value), ['v2', 'cinema']);
  const soul = manifest.models.find(model => model.id === 'higgsfield-soul-2').controls.find(control => control.key === 'custom_reference_id');
  assert.deepEqual([soul.type, soul.identity], ['string', { family: 'higgsfield-soul', version: 'v2' }]);
  assert.equal(manifest.models.find(model => model.id === 'higgsfield-higgsfield-ai-soul-cinema').controls.find(control => control.key === 'custom_reference_id').identity.version, 'cinema');
  let sent = 0;
  await mock(async () => { sent++; return Response.json({}); }, async () => {
    const request = options => ({ model: { id: 'higgsfield-soul-2', kind: 'image' }, input: { prompt: 'Mina at a cafe', options }, configuration, signal: signal(), requestKey: 'soul-1' });
    await assert.rejects(createGeneration(request({ custom_reference_id: 'mina' })), /A Soul ID looks like/);
    await assert.rejects(createGeneration(request({ custom_reference_id: ID, custom_reference_strength: 0 })), /strength above 0/);
  });
  assert.equal(sent, 0);
});
