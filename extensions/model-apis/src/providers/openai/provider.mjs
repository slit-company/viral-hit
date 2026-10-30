import { sendJson } from '../../kit/http.mjs';
import { credential } from '../../kit/polling.mjs';
import { readReference, fromBase64, extensionFor } from '../../kit/media.mjs';
import { promptOf, optionsOf, aspectOf, referencesOf, select, refs } from '../../kit/options.mjs';
// OpenAI Image API: https://developers.openai.com/api/docs/guides/image-generation
const API = 'https://api.openai.com/v1';
const SIZES = {
  '1K': { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536', '16:9': '1536x864', '9:16': '864x1536', '4:3': '1344x1008', '3:4': '1008x1344', '21:9': '1792x768' },
  '2K': { '1:1': '2048x2048', '3:2': '2048x1360', '2:3': '1360x2048', '16:9': '2048x1152', '9:16': '1152x2048', '4:3': '2048x1536', '3:4': '1536x2048', '21:9': '2560x1088' },
};
const controls = [select('resolution', 'Resolution', ['1K', '2K']), select('quality', 'Quality', ['auto', 'low', 'medium', 'high', 'xhigh', 'max']), select('background', 'Background', ['auto', 'opaque', 'transparent'])];
const image = (id, name, upstreamModelId) => ({ id, name, kind: 'image', upstreamModelId, studioTasks: ['image-generate', 'image-edit'], aspectRatios: ['auto', ...Object.keys(SIZES['1K'])], defaultAspectRatio: 'auto', controls, referenceInputs: refs([0, 16]) });
export const manifest = { id: 'openai', setupUrl: 'https://platform.openai.com/api-keys', label: 'OpenAI', description: 'GPT Image 2.5 Sunburst and Flare through the OpenAI Image API: text-to-image and edits with up to 16 reference images.', environment: ['OPENAI_API_KEY'], models: [image('openai-gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst', 'gpt-image-2.5-sunburst'), image('openai-gpt-image-2.5-flare', 'GPT Image 2.5 Flare', 'gpt-image-2.5-flare')] };

const key = configuration => credential(configuration, 'OPENAI_API_KEY', 'OpenAI');

export async function createGeneration({ model, input, configuration, signal, readMedia }) {
  const profile = manifest.models.find(item => item.id === model.id);
  if (!profile) throw Error('Unknown OpenAI model');
  const prompt = promptOf(input, { max: 32_000 }), options = optionsOf(profile, input), aspect = aspectOf(profile, input), references = referencesOf(profile, input).image;
  if (options.background === 'transparent' && references.length) throw Error('Transparent backgrounds are available for new images, not edits');
  const size = aspect === 'auto' ? 'auto' : SIZES[options.resolution][aspect];
  const fields = { model: profile.upstreamModelId, prompt, size, quality: options.quality, background: options.background, output_format: 'png' };
  const headers = { Authorization: 'Bearer ' + key(configuration) };
  let data;
  if (references.length) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    for (const [index, reference] of references.entries()) { const media = await readReference(readMedia, reference); form.append('image[]', new Blob([media.bytes], { type: media.mimeType }), 'reference-' + index + '.' + extensionFor(media.mimeType)); }
    if (input.maskUrl) { const mask = await readReference(readMedia, input.maskUrl); form.append('mask', new Blob([mask.bytes], { type: mask.mimeType }), 'mask.png'); }
    data = await sendJson('OpenAI', API + '/images/edits', { method: 'POST', body: form, headers, signal, timeout: 300_000, maxBytes: 80_000_000 });
  } else data = await sendJson('OpenAI', API + '/images/generations', { method: 'POST', body: fields, headers, signal, timeout: 300_000, maxBytes: 80_000_000 });
  return { status: 'succeeded', media: [fromBase64(data.data?.[0]?.b64_json, 'image/png', 'image')] };
}

export async function testConnection({ configuration, signal }) {
  await sendJson('OpenAI', API + '/models?limit=1', { headers: { Authorization: 'Bearer ' + key(configuration) }, signal });
  return { ok: true };
}
