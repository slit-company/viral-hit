import test from 'node:test';
import assert from 'node:assert/strict';
import { providerModelSchema } from './manifest';
import { validateInstalledAudioInput } from './audio-input';
import { validateInstalledVisualInput } from './visual-input';

test('a model that declares no prompt or an optional one runs from its sources; others still ask for a prompt', () => {
  const model = { id: 'split', name: 'Split', kind: 'image', aspectRatios: ['auto'], referenceInputs: { image: { min: 1, max: 1 }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 } } };
  const input = { prompt: '  ', image_urls: ['https://example.com/picture.png'] };
  assert.equal(validateInstalledVisualInput(input, providerModelSchema.parse({ ...model, promptInput: 'none' })).prompt, '');
  assert.equal(validateInstalledVisualInput(input, providerModelSchema.parse({ ...model, promptInput: 'optional' })).prompt, '');
  assert.throws(() => validateInstalledVisualInput(input, providerModelSchema.parse(model)), /Enter a prompt for Split/);
  // Audio: extracting a clip's sound needs only the clip; speech and music still need their text.
  const clip = { prompt: '', video_urls: ['https://example.com/clip.mp4'] }, sources = { image: { min: 0, max: 0 }, video: { min: 1, max: 1 }, audio: { min: 0, max: 0 } };
  assert.equal(validateInstalledAudioInput(clip, sources, 'none').prompt, '');
  assert.throws(() => validateInstalledAudioInput(clip, sources), /Enter a prompt or script/);
});
