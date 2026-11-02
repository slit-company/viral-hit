import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBody, checkInput, profileFor, providerManifest } from '../src/profiles.mjs';
import { outputSource } from '../src/results.mjs';
import { inlineMedia, limitedJson } from '../src/client.mjs';
import { checkStatus, createGeneration } from '../src/provider.mjs';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const MP4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
const image = { base64: PNG.toString('base64'), mimeType: 'image/png' };
const audio = { base64: 'UklGRg==', mimeType: 'audio/wav' };
const configuration = { COMFY_API_KEY: 'fixture-comfy-key' };
function body(id, input = {}, images = [], audios = []) {
  const profile = profileFor('comfy-' + id);
  return buildBody(profile, checkInput(profile, { prompt: 'A courier runs', ...input }), images, audios);
}
async function mock(handler, run) { const original = globalThis.fetch; globalThis.fetch = handler; try { await run(); } finally { globalThis.fetch = original; } }
const response = data => Response.json(data);

test('the manifest has unique canonical models with buildable defaults and bounded controls', () => {
  const models = providerManifest().models;
  assert.equal(new Set(models.map(model => model.id)).size, 28);
  assert.equal(models.filter(model => model.kind === 'video').length, 18);
  for (const model of models) {
    const images = Array.from({ length: model.referenceInputs?.image.min ?? 0 }, () => image);
    const checked = checkInput(model, { prompt: 'An orange bicycle', imageUrls: images.map((_, index) => 'owned:' + index) });
    assert.equal(typeof buildBody(model, checked, images), 'object', model.id);
    assert.ok((model.durations?.length ?? 0) <= 12);
    assert.ok((model.controls ?? []).every(control => typeof control.label === 'string' && control.label.length));
  }
});

test('Seedance frames, reference mode and audio follow its model-specific restrictions', () => {
  const frame = body('seedance-2.5', { imageUrls: ['a', 'b'], aspectRatio: '9:16' }, [image, image]);
  assert.equal(frame.ratio, 'adaptive');
  assert.deepEqual(frame.content.slice(1).map(item => item.role), ['first_frame', 'last_frame']);
  assert.equal(frame.watermark, false);
  const reference = body('seedance-2.5', { imageUrls: ['a', 'b', 'c'], audioUrls: ['voice'], options: { reference_mode: 'references' } }, [image, image, image], [audio]);
  assert.deepEqual(reference.content.slice(1).map(item => item.role), ['reference_image', 'reference_image', 'reference_image', 'reference_audio']);
  assert.match(reference.content.at(-1).audio_url.url, /^data:audio\/wav;base64,/);
  assert.equal(body('seedance-2.0', { imageUrls: ['a'], aspectRatio: '9:16' }, [image]).ratio, '9:16');
  assert.throws(() => body('seedance-2.0', { audioUrls: ['voice'] }), /audio needs at least one image/);
  assert.throws(() => body('seedance-2.0', { options: { resolution: '1080p' } }), /Invalid/);
  assert.throws(() => body('seedance-2.5', { imageUrls: ['a', 'b', 'c'] }), /first\/last frames/);
});

test('Veo maps first and last image bytes, duration and resolution without silent dropping', () => {
  const result = body('veo-3.1', { imageUrls: ['a', 'b'], duration: '8s', options: { resolution: '1080p', generate_audio: false } }, [image, image]);
  assert.deepEqual(result.instances[0].image, { bytesBase64Encoded: image.base64, mimeType: 'image/png' });
  assert.deepEqual(result.instances[0].lastFrame, result.instances[0].image);
  assert.deepEqual(result.parameters, { aspectRatio: '16:9', durationSeconds: 8, resolution: '1080p', generateAudio: false, enhancePrompt: false, sampleCount: 1 });
  assert.throws(() => body('veo-3.1', { duration: '6s', options: { resolution: '1080p' } }), /8-second/);
  assert.throws(() => body('veo-3.1', { imageUrls: ['a', 'b', 'c'] }), /reference count/);
});

test('Kling, Wan and Grok distinguish frames from image references', () => {
  const kling = body('kling-v3-omni', { imageUrls: ['a', 'b'], options: { sound: 'on' } }, [image, image]);
  assert.equal(kling.duration, '6'); assert.equal(kling.sound, 'on');
  assert.deepEqual(kling.image_list.map(item => item.type), ['first_frame', 'end_frame']);
  assert.deepEqual(body('kling-o1', { imageUrls: ['a'], options: { reference_mode: 'references' } }, [image]).image_list, [{ image_url: image.base64 }]);
  const wan = body('wan-3.0-prime', { imageUrls: ['a', 'b'], options: { reference_mode: 'references' } }, [image, image]);
  assert.deepEqual(wan.input.media.map(item => item.type), ['reference_image', 'reference_image']);
  assert.equal(wan.parameters.resolution, '1080P');
  const grok = body('grok-imagine-video-1.5', { imageUrls: ['a'], options: {} }, [image]);
  assert.equal(grok.image.type, 'image_url');
  assert.equal('reference_images' in grok, false);
  assert.throws(() => body('grok-imagine-video-1.5', { imageUrls: ['a', 'b'] }), /first\/last frames/);
  const refs = body('grok-imagine-video-1.5-lite', { imageUrls: ['a', 'b'], options: { reference_mode: 'references' } }, [image, image]);
  assert.equal(refs.reference_images.length, 2); assert.equal('image' in refs, false);
  assert.throws(() => body('kling-v3', { prompt: 'a'.repeat(2501) }), /2500/);
});

test('image generation and editing use the native fields without falsely declaring masks', () => {
  const gemini = body('nano-banana-2.1', { imageUrls: ['a'] }, [image]);
  assert.equal(gemini.uploadImagesToStorage, true);
  assert.equal(gemini.contents[0].parts[0].inlineData.data, image.base64);
  const gpt = body('gpt-image-2.5-sunburst', { imageUrls: ['a'], aspectRatio: '2:3' }, [image]);
  assert.equal(gpt.size, '1024x1536'); assert.match(gpt.image[0], /^data:image\/png;base64,/);
  assert.equal(body('gpt-image-2.5-flare').image, undefined);
  const seedream = body('seedream-5.0-pro', { aspectRatio: '9:16', options: { resolution: '2K' } });
  const [w, h] = seedream.size.split('x').map(Number);
  assert.ok(Math.abs(w / h - 9 / 16) < 0.01); assert.ok(w * h <= 4194304 && w * h >= 1048576);
  assert.deepEqual(body('ideogram-v4', { aspectRatio: '16:9' }), { text_prompt: 'A courier runs', resolution: '2560x1440' });
  const relight = body('bria-relight', { imageUrls: ['a'], options: { light_direction: 'side' } }, [image]);
  assert.equal(relight.light_direction, 'side'); assert.equal(relight.image, image.base64);
  assert.throws(() => body('bria-remove-background'), /reference count/);
  assert.throws(() => body('gpt-image-2.5-sunburst', { maskUrl: 'mask' }), /does not accept/);
});

test('each family reads only its documented output and inline media is signature-checked', () => {
  const url = 'https://cdn.example.com/result.mp4';
  for (const [id, result] of [
    ['seedance-2.5', { content: { video_url: url } }],
    ['kling-v3-omni', { data: { task_result: { videos: [{ url }] } } }],
    ['wan-3.0', { output: { video_url: url } }],
    ['grok-imagine-video-1.5', { video: { url } }],
    ['bria-relight', { result: { image_url: url } }],
    ['seedream-5.0-pro', { data: [{ url }] }],
  ]) assert.deepEqual(outputSource(profileFor('comfy-' + id), result), { url }, id);
  const veo = outputSource(profileFor('comfy-veo-3.1'), { response: { videos: [{ bytesBase64Encoded: MP4.toString('base64') }] } });
  assert.equal(inlineMedia(veo.base64, 'video', veo.mimeType).mimeType, 'video/mp4');
  const gemini = outputSource(profileFor('comfy-nano-banana-pro'), { candidates: [{ content: { parts: [{ text: 'done' }, { inlineData: { data: image.base64, mimeType: image.mimeType } }] } }] });
  assert.equal(inlineMedia(gemini.base64, 'image', gemini.mimeType).mimeType, 'image/png');
  assert.throws(() => inlineMedia('%%%=', 'image'), /invalid base64/);
  assert.throws(() => inlineMedia(PNG.toString('base64'), 'video'), /not supported video/);
  assert.throws(() => inlineMedia(PNG.toString('base64'), 'image', 'image/jpeg'), /does not match/);
  assert.throws(() => outputSource(profileFor('comfy-veo-3.1'), { thumbnail: { url } }), /without usable/);
});

test('inline results above 4 MB collect through the queued lifecycle without a second submit', async () => {
  const video = Buffer.concat([MP4, Buffer.alloc(3_100_000)]);
  const result = { response: { videos: [{ bytesBase64Encoded: video.toString('base64') }] } };
  let posts = 0;
  await mock(async (url, init) => {
    if (init.method === 'POST') { posts++; return response({ request_id: 'req_inline_veo' }); }
    return String(url).endsWith('/status') ? response({ status: 'COMPLETED' }) : response(result);
  }, async () => {
    const model = profileFor('comfy-veo-3.1');
    const job = await createGeneration({ model, input: { prompt: 'sunrise' }, configuration, requestKey: 'inline-run' });
    const originalNow = Date.now; Date.now = () => originalNow() + 4000;
    try {
      const done = await checkStatus({ model, taskId: job.taskId, configuration });
      assert.equal(done.status, 'succeeded'); assert.equal(done.media[0].data.length, video.length);
    } finally { Date.now = originalNow; }
  });
  assert.equal(posts, 1);
  await assert.rejects(limitedJson(response(result)), /exceeded/);
});

test('unsupported image MIME types fail before creating a paid request', async () => {
  await mock(() => { throw Error('must not send'); }, async () => {
    for (const id of ['comfy-kling-v3-omni', 'comfy-veo-3.1']) {
      await assert.rejects(createGeneration({ model: profileFor(id), configuration, requestKey: id, input: { prompt: 'p', imageUrls: ['owned:a'] },
        readMedia: async () => ({ bytes: PNG, mimeType: 'image/webp' }) }), /PNG or JPEG/);
    }
  });
});
