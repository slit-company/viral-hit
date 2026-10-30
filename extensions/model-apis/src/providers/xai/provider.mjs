import { sendJson, isTransient } from '../../kit/http.mjs';
import { credential, createPacer, processing, taskId, parseTaskId, unknownCost } from '../../kit/polling.mjs';
import { readReference, fromBase64, dataUri, downloadResult } from '../../kit/media.mjs';
import { promptOf, optionsOf, aspectOf, secondsOf, referencesOf, select, refs } from '../../kit/options.mjs';
// xAI Imagine API: https://docs.x.ai/developers/rest-api-reference/inference/images.md and videos.md
const API = 'https://api.x.ai/v1';
const RATIOS = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '2:1', '1:2'];
const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'];
const video = (id, name, upstreamModelId) => ({ id, name, kind: 'video', upstreamModelId, studioTasks: ['video-generate'], aspectRatios: VIDEO_RATIOS, defaultAspectRatio: '16:9', durations: ['3s', '5s', '6s', '8s', '10s', '12s', '15s'], defaultDuration: '8s', controls: [select('resolution', 'Resolution', ['720p', '480p', '1080p']), select('image_use', 'Image use', ['first-frame', 'references'], 'first-frame', { 'first-frame': 'First frame (and last)', references: 'Reference images' })], referenceInputs: refs([0, 7]) });
export const manifest = {
  id: 'xai', label: 'xAI Grok Imagine', description: 'Grok Imagine image generation and editing, and Grok Imagine Video 1.5 with first/last frames or reference images.', environment: ['XAI_API_KEY'],
  models: [
    { id: 'xai-grok-imagine-image-2', name: 'Grok Imagine Image 2', kind: 'image', upstreamModelId: 'grok-imagine-image-2.0', studioTasks: ['image-generate', 'image-edit'], aspectRatios: RATIOS, defaultAspectRatio: 'auto', controls: [select('resolution', 'Resolution', ['1k', '1.5k', '2k'])], referenceInputs: refs([0, 5]) },
    video('xai-grok-imagine-video-1.5', 'Grok Imagine Video 1.5', 'grok-imagine-video-1.5'),
    video('xai-grok-imagine-video-1.5-lite', 'Grok Imagine Video 1.5 Lite', 'grok-imagine-video-1.5-lite'),
  ],
};
const pacer = createPacer(4, 15);
const headers = configuration => ({ Authorization: 'Bearer ' + credential(configuration, 'XAI_API_KEY', 'xAI', /^xai-[\w-]{16,}$/) });
const images = async (list, readMedia) => { const urls = []; for (const reference of list) urls.push({ url: dataUri(await readReference(readMedia, reference)) }); return urls; };

export async function createGeneration({ model, input, configuration, signal, readMedia }) {
  const profile = manifest.models.find(item => item.id === model.id);
  if (!profile) throw Error('Unknown xAI model');
  const prompt = promptOf(input, { max: 8_000 }), options = optionsOf(profile, input), aspect = aspectOf(profile, input), references = await images(referencesOf(profile, input).image, readMedia);
  if (profile.kind === 'image') {
    const body = { model: profile.upstreamModelId, prompt, n: 1, response_format: 'b64_json', resolution: options.resolution, ...(aspect !== 'auto' ? { aspect_ratio: aspect } : {}), ...(references.length === 1 ? { image: references[0] } : references.length ? { images: references } : {}) };
    const data = await sendJson('xAI', API + (references.length ? '/images/edits' : '/images/generations'), { method: 'POST', body, headers: headers(configuration), signal, timeout: 300_000, maxBytes: 60_000_000 });
    return { status: 'succeeded', media: [fromBase64(data.data?.[0]?.b64_json, data.data?.[0]?.mime_type ?? 'image/png', 'image')] };
  }
  const frames = options.image_use === 'first-frame';
  if (frames && references.length > 2) throw Error('Use up to two frames, or switch Image use to Reference images');
  const body = { model: profile.upstreamModelId, prompt, aspect_ratio: aspect, duration: secondsOf(profile, input), resolution: options.resolution, ...(frames && references[0] ? { image: references[0] } : {}), ...(frames && references[1] ? { last_frame: references[1] } : {}), ...(!frames && references.length ? { reference_images: references } : {}) };
  let data;
  try { data = await sendJson('xAI', API + '/videos/generations', { method: 'POST', body, headers: headers(configuration), signal, timeout: 120_000 }); }
  catch (error) { if (isTransient(error)) throw Error('xAI submission outcome is unknown. Check xAI usage before creating another generation.'); throw error; }
  const id = taskId('xai', data.request_id);
  pacer.defer(id);
  return { status: 'processing', taskId: id, cost: unknownCost };
}

export async function checkStatus({ taskId: id, configuration, signal }) {
  const request = parseTaskId('xai', id);
  if (pacer.wait(id)) return processing(id);
  let data;
  try { data = await sendJson('xAI', API + '/videos/' + encodeURIComponent(request), { headers: headers(configuration), signal }); }
  catch (error) { if (isTransient(error)) { pacer.defer(id, error.retryAfter); return processing(id); } throw error; }
  const cents = Number.isFinite(data.usage?.cost_in_usd_ticks) ? data.usage.cost_in_usd_ticks / 100_000_000 : undefined;
  const cost = cents !== undefined ? { state: 'captured', final: true, usdCents: { captured: cents } } : undefined;
  if (data.status === 'pending') { pacer.defer(id); return processing(id); }
  pacer.done(id);
  if (data.status !== 'done') return { status: 'failed', taskId: id, error: 'xAI video ' + (data.error?.message ?? data.status), ...(cost ? { cost } : {}) };
  if (!data.video?.url) return { status: 'failed', taskId: id, error: 'xAI moderated or withheld this video', ...(cost ? { cost } : {}) };
  return { status: 'succeeded', taskId: id, media: [await downloadResult('xAI', data.video.url, 'video', { signal })], ...(cost ? { cost } : {}) };
}

export async function testConnection({ configuration, signal }) {
  await sendJson('xAI', API + '/models', { headers: headers(configuration), signal });
  return { ok: true };
}
