import test from 'node:test';
import assert from 'node:assert/strict';
import * as falProvider from '../src/providers/fal/provider.mjs';
import * as runwayProvider from '../src/providers/runway/provider.mjs';
import * as googleProvider from '../src/providers/google/provider.mjs';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 1, 2]);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function server(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const key = (init.method ?? 'GET') + ' ' + url;
    calls.push({ key, init });
    const route = Object.entries(routes).find(([pattern]) => key.startsWith(pattern));
    if (!route) return json({ detail: 'no route ' + key }, 404);
    return typeof route[1] === 'function' ? route[1](init) : route[1];
  };
  return calls;
}
const readMedia = async () => ({ bytes: PNG, mimeType: 'image/png' });
const later = async (provider, args) => { for (let i = 0; i < 20; i++) { const result = await provider.checkStatus(args); if (result.status !== 'processing') return result; await new Promise(resolve => setTimeout(resolve, 0)); Date.now = (now => () => now() + 60_000)(Date.now); } throw Error('never finished'); };

test('fal uploads references, submits to the queue, polls and downloads the result once', async () => {
  const calls = server({
    'POST https://rest.fal.ai/storage/upload/initiate': json({ upload_url: 'https://upload.fal/x', file_url: 'https://v3.fal.media/ref.png' }),
    'PUT https://upload.fal/x': new Response(''),
    'POST https://queue.fal.run/bytedance/seedance-2.5/us/image-to-video': json({ request_id: 'r1', response_url: 'https://queue.fal.run/bytedance/seedance-2.5/requests/abcdef12-3456' }),
    'GET https://queue.fal.run/bytedance/seedance-2.5/requests/abcdef12-3456/status': json({ status: 'COMPLETED' }),
    'GET https://queue.fal.run/bytedance/seedance-2.5/requests/abcdef12-3456': json({ video: { url: 'https://v3.fal.media/out.mp4' } }),
    'GET https://v3.fal.media/out.mp4': new Response(MP4, { headers: { 'content-type': 'video/mp4' } }),
  });
  const model = { id: 'fal-bytedance-seedance-2.5-us-image-to-video', kind: 'video' }, configuration = { FAL_KEY: 'key-id:key-secret-value' };
  const created = await falProvider.createGeneration({ model, input: { prompt: 'walk', duration: '5s', imageUrls: ['local'] }, configuration, readMedia, requestKey: 'job-1' });
  assert.equal(created.status, 'processing');
  const submitted = JSON.parse(calls.find(call => call.key.includes('image-to-video')).init.body);
  assert.equal(submitted.image_url, 'https://v3.fal.media/ref.png');
  const done = await later(falProvider, { model, taskId: created.taskId, configuration });
  assert.equal(done.status, 'succeeded');
  assert.equal(done.media[0].mimeType, 'video/mp4');
});

test('a network failure after submission reports an unknown outcome instead of retrying', async () => {
  server({ 'POST https://queue.fal.run/': () => { throw TypeError('socket hang up'); } });
  await assert.rejects(falProvider.createGeneration({ model: { id: 'fal-google-nano-banana-2.1', kind: 'image' }, input: { prompt: 'cat' }, configuration: { FAL_KEY: 'key-id:key-secret-value' }, readMedia, requestKey: 'job-2' }), /outcome is unknown/);
});

test('Runway sends small references inline and reports task credits', async () => {
  const calls = server({
    'POST https://api.dev.runwayml.com/v1/image_to_video': json({ id: '11111111-2222-3333-4444-555555555555' }),
    'GET https://api.dev.runwayml.com/v1/tasks/': json({ status: 'SUCCEEDED', output: ['https://dnznrvs05pmza.cloudfront.net/out.mp4'], cost: { credits: 40 } }),
    'GET https://dnznrvs05pmza.cloudfront.net/out.mp4': new Response(MP4, { headers: { 'content-type': 'video/mp4' } }),
  });
  const model = { id: 'runway-image-to-video-gen4.5', kind: 'video' }, configuration = { RUNWAYML_API_SECRET: 'key_abcdefghijklmnop' };
  const created = await runwayProvider.createGeneration({ model, input: { prompt: 'zoom', aspectRatio: '16:9', duration: '5s', imageUrls: ['local'] }, configuration, readMedia, requestKey: 'job-3' });
  const sent = JSON.parse(calls[0].init.body);
  assert.match(typeof sent.promptImage === 'string' ? sent.promptImage : sent.promptImage[0].uri, /^data:image\/png;base64,/);
  assert.equal(calls[0].init.headers['X-Runway-Version'], '2024-11-06');
  const done = await later(runwayProvider, { model, taskId: created.taskId, configuration });
  assert.equal(done.status, 'succeeded');
  assert.deepEqual(done.cost, { state: 'captured', final: true, unit: 'credits', captured: 40 });
});

test('Gemini Omni video waits for the file to become active, then downloads it with the key', async () => {
  let state = 'PROCESSING';
  const calls = server({
    'POST https://generativelanguage.googleapis.com/v1beta/interactions': json({ output_video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc123:download?alt=media' } }),
    'GET https://generativelanguage.googleapis.com/v1beta/files/abc123:download': new Response(MP4, { headers: { 'content-type': 'video/mp4' } }),
    'GET https://generativelanguage.googleapis.com/v1beta/files/abc123': () => { const reply = json({ state }); state = 'ACTIVE'; return reply; },
  });
  const model = { id: 'google-gemini-omni-flash', kind: 'video' }, configuration = { GEMINI_API_KEY: 'AIzaSyTestKeyValue1234567890' };
  const created = await googleProvider.createGeneration({ model, input: { prompt: 'sunset', aspectRatio: '9:16' }, configuration, readMedia });
  assert.equal(JSON.parse(calls[0].init.body).response_format.aspect_ratio, '9:16');
  const done = await later(googleProvider, { model, taskId: created.taskId, configuration });
  assert.equal(done.status, 'succeeded');
  assert.equal(calls.at(-1).init.headers['x-goog-api-key'], configuration.GEMINI_API_KEY);
});
