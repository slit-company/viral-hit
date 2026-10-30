import test from 'node:test';
import assert from 'node:assert/strict';
import { admit, requestBody, collectMedia } from '../src/kit/catalog-request.mjs';
import { profileFromSchema } from '../src/kit/schema-profile.mjs';
import fal from '../src/providers/fal/catalog.json' with { type: 'json' };
import runway from '../src/providers/runway/catalog.json' with { type: 'json' };
import higgsfield from '../src/providers/higgsfield/catalog.json' with { type: 'json' };

const entry = (catalog, upstream) => catalog.models.find(item => item.model.upstreamModelId === upstream);
const body = (catalog, upstream, input, uploaded = {}) => { const { model, binding } = entry(catalog, upstream); return requestBody(model, binding, admit(model, binding, input), { image: [], video: [], audio: [], ...uploaded }, input.seed); };

test('first and last frames land in the image and end-image fields with string durations', () => {
  const result = body(fal, 'bytedance/seedance-2.5/us/image-to-video', { prompt: 'run', duration: '8s', imageUrls: ['a', 'b'], options: { resolution: '1080p' } }, { image: ['https://x/a.png', 'https://x/b.png'] });
  assert.deepEqual(result, { prompt: 'run', resolution: '1080p', generate_audio: true, duration: '8', image_url: 'https://x/a.png', end_image_url: 'https://x/b.png' });
});

test('Runway maps aspect and resolution to its pixel ratio and two frames to keyframe positions', () => {
  const result = body(runway, 'image_to_video/veo3.1', { prompt: 'p', aspectRatio: '9:16', duration: '8s', imageUrls: ['a', 'b'], options: { resolution: '1080p' } }, { image: ['data:a', 'data:b'] });
  assert.equal(result.model, 'veo3.1');
  assert.equal(result.ratio, '1080:1920');
  assert.deepEqual(result.promptImage, [{ uri: 'data:a', position: 'first' }, { uri: 'data:b', position: 'last' }]);
});

test('optional choices without a vendor default are omitted until the user picks one', () => {
  const { model } = entry(higgsfield, 'higgsfield/cinema-studio/4.0');
  const genre = model.controls.find(item => item.key === 'genre');
  assert.equal(genre.default, 'model-default');
  const plain = body(higgsfield, 'higgsfield/cinema-studio/4.0', { prompt: 'a chase', aspectRatio: '16:9', duration: '5s' });
  assert.equal('genre' in plain, false);
  const picked = body(higgsfield, 'higgsfield/cinema-studio/4.0', { prompt: 'a chase', aspectRatio: '16:9', duration: '5s', options: { genre: genre.choices[1].value } });
  assert.equal(picked.genre, genre.choices[1].value);
});

test('admission rejects reference counts, aspect ratios and options the model does not declare', () => {
  const { model, binding } = entry(fal, 'bytedance/seedance-2.5/us/image-to-video');
  assert.throws(() => admit(model, binding, { prompt: 'x' }), /image reference/);
  assert.throws(() => admit(model, binding, { prompt: 'x', imageUrls: ['a'], options: { unknown: 1 } }), /Unknown model option/);
  const t2v = entry(runway, 'text_to_video/gen4.5');
  assert.throws(() => admit(t2v.model, t2v.binding, { prompt: 'x', aspectRatio: '1:1' }), /aspect ratio/);
});

test('result collection finds nested media of the requested kind and ignores thumbnails and inputs', () => {
  const output = { video: { url: 'https://cdn/v.mp4', content_type: 'video/mp4' }, thumbnail: { url: 'https://cdn/t.jpg' }, input: { image_url: 'https://cdn/in.png' } };
  assert.deepEqual(collectMedia(output, 'video').map(item => item.url), ['https://cdn/v.mp4']);
  assert.deepEqual(collectMedia({ images: [{ url: 'https://cdn/1.png' }, { url: 'https://cdn/2.png' }] }, 'image').length, 2);
  assert.deepEqual(collectMedia(['https://cdn/out.mp4'], 'video').length, 1);
});

test('every required upstream field is bound and reference maxima stay within the Studio limit', () => {
  for (const catalog of [fal, runway, higgsfield]) for (const { model } of catalog.models) {
    const total = Object.values(model.referenceInputs ?? {}).reduce((sum, range) => sum + range.max, 0);
    assert.ok(total <= 20, model.id);
    assert.ok(model.kind === 'audio' || model.aspectRatios?.length, model.id);
  }
  const { model, binding } = profileFromSchema('t', { endpoint: 'x/y', name: 'Y', kind: 'video', tasks: ['video-generate'] }, { required: ['prompt', 'image_url'], properties: { prompt: { type: 'string' }, image_url: { type: 'string', format: 'uri' }, duration: { type: 'integer', minimum: 3, maximum: 40 } } });
  assert.deepEqual(model.referenceInputs.image, { min: 1, max: 1 });
  assert.ok(model.durations.length <= 12 && model.durations.includes('3s'));
  assert.equal(binding.duration.format, 'integer');
});
