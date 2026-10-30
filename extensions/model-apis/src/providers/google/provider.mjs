import { sendJson, send, isTransient } from '../../kit/http.mjs';
import { credential, createPacer, processing, taskId, parseTaskId, unknownCost } from '../../kit/polling.mjs';
import { readReference, fromBase64, outputMime } from '../../kit/media.mjs';
import { promptOf, optionsOf, aspectOf, referencesOf, select, refs } from '../../kit/options.mjs';
// Gemini Interactions API: https://ai.google.dev/gemini-api/docs/image-generation and /docs/omni
const API = 'https://generativelanguage.googleapis.com/v1beta';
const IMAGE_RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'];
const image = (id, name, upstreamModelId, maxRefs) => ({ id, name, kind: 'image', upstreamModelId, studioTasks: ['image-generate', 'image-edit'], aspectRatios: IMAGE_RATIOS, defaultAspectRatio: 'auto', controls: [select('image_size', 'Resolution', ['1K', '2K', '4K'])], referenceInputs: refs([0, maxRefs]) });
export const manifest = {
  id: 'google', label: 'Google Gemini', description: 'Nano Banana image generation and editing, and Gemini Omni Flash video with audio, through the Gemini API.', environment: ['GEMINI_API_KEY'],
  models: [
    image('google-nano-banana-2.1', 'Nano Banana 2.1', 'gemini-nano-banana-2.1', 14),
    image('google-nano-banana-pro', 'Nano Banana Pro', 'gemini-3-pro-image', 14),
    image('google-nano-banana-2-lite', 'Nano Banana 2 Lite', 'gemini-3.1-flash-lite-image', 3),
    { id: 'google-gemini-omni-flash', name: 'Gemini Omni Flash', kind: 'video', upstreamModelId: 'gemini-omni-1.1-flash', studioTasks: ['video-generate'], aspectRatios: ['16:9', '9:16'], defaultAspectRatio: '16:9', controls: [select('resolution', 'Resolution', ['720p', '1080p', '4k', '360p'])], referenceInputs: refs([0, 3]) },
  ],
};
const pacer = createPacer(5, 20);
const headers = configuration => ({ 'x-goog-api-key': credential(configuration, 'GEMINI_API_KEY', 'Gemini', /^[\w-]{20,}$/) });

async function content(input, references, readMedia) {
  const parts = [];
  for (const reference of references) { const media = await readReference(readMedia, reference); parts.push({ type: 'image', data: Buffer.from(media.bytes).toString('base64'), mime_type: media.mimeType }); }
  return [...parts, { type: 'text', text: input }];
}
const outputs = data => (data.steps ?? []).filter(step => step.type === 'model_output').flatMap(step => step.content ?? []);

export async function createGeneration({ model, input, configuration, signal, readMedia }) {
  const profile = manifest.models.find(item => item.id === model.id);
  if (!profile) throw Error('Unknown Gemini model');
  const prompt = promptOf(input, { max: 30_000 }), options = optionsOf(profile, input), aspect = aspectOf(profile, input);
  const body = { model: profile.upstreamModelId, input: await content(prompt, referencesOf(profile, input).image, readMedia) };
  if (profile.kind === 'image') {
    body.response_format = { type: 'image', image_size: options.image_size, ...(aspect !== 'auto' ? { aspect_ratio: aspect } : {}) };
    const data = await sendJson('Gemini', API + '/interactions', { method: 'POST', body, headers: headers(configuration), signal, timeout: 300_000, maxBytes: 100_000_000 });
    const block = outputs(data).findLast(item => item.type === 'image' && item.data);
    if (!block) throw Error('Gemini returned no image' + (data.status ? ' (' + data.status + ')' : ''));
    return { status: 'succeeded', media: [fromBase64(block.data, block.mime_type, 'image')] };
  }
  body.response_format = { type: 'video', aspect_ratio: aspect, resolution: options.resolution, delivery: 'uri' };
  let data;
  try { data = await sendJson('Gemini', API + '/interactions', { method: 'POST', body, headers: headers(configuration), signal, timeout: 300_000, maxBytes: 4_000_000 }); }
  catch (error) { if (isTransient(error)) throw Error('Gemini submission outcome is unknown. Check Gemini API usage before creating another generation.'); throw error; }
  const uri = data.output_video?.uri ?? outputs(data).find(item => item.type === 'video')?.uri;
  const file = /\/files\/([\w-]{1,120})/.exec(uri ?? '')?.[1];
  if (!file) throw Error('Gemini did not return a video file reference');
  const id = taskId('gm', file);
  pacer.defer(id);
  return { status: 'processing', taskId: id, cost: unknownCost };
}

export async function checkStatus({ taskId: id, configuration, signal }) {
  const file = parseTaskId('gm', id);
  if (pacer.wait(id)) return processing(id);
  let info;
  try { info = await sendJson('Gemini', API + '/files/' + file, { headers: headers(configuration), signal }); }
  catch (error) { if (isTransient(error)) { pacer.defer(id, error.retryAfter); return processing(id); } throw error; }
  if (info.state === 'PROCESSING' || info.state === 'STATE_UNSPECIFIED') { pacer.defer(id); return processing(id); }
  pacer.done(id);
  if (info.state !== 'ACTIVE') return { status: 'failed', taskId: id, error: 'Gemini video ' + String(info.state ?? 'failed').toLowerCase() };
  const { bytes, type } = await send('Gemini', API + '/files/' + file + ':download?alt=media', { headers: headers(configuration), signal, timeout: 300_000, maxBytes: 512 * 1048576 });
  return { status: 'succeeded', taskId: id, media: [{ data: bytes, mimeType: outputMime(type || info.mimeType, '', 'video') }] };
}

export async function testConnection({ configuration, signal }) {
  await sendJson('Gemini', API + '/models?pageSize=1', { headers: headers(configuration), signal });
  return { ok: true };
}
