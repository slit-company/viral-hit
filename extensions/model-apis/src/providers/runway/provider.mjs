import { send, sendJson } from '../../kit/http.mjs';
import { credential } from '../../kit/polling.mjs';
import { dataUri, extensionFor } from '../../kit/media.mjs';
import { catalogProvider } from '../../kit/catalog-provider.mjs';
import catalog from './catalog.json' with { type: 'json' };
// Runway Dev API: https://docs.dev.runwayml.com/ai-context.md
const API = 'https://api.dev.runwayml.com';
const INLINE_LIMIT = 3_300_000; // data URIs are capped at 5 MB after base64 encoding

const client = (configuration, signal) => {
  const key = credential(configuration, 'RUNWAYML_API_SECRET', 'Runway');
  const call = (path, options = {}) => sendJson('Runway', API + path, { ...options, signal, headers: { Authorization: 'Bearer ' + key, 'X-Runway-Version': '2024-11-06', ...options.headers } });
  return { call, signal };
};

async function upload(api, media) {
  if (media.bytes.length <= INLINE_LIMIT) return dataUri(media);
  const target = await api.call('/v1/uploads', { method: 'POST', body: { filename: 'reference.' + extensionFor(media.mimeType), type: 'ephemeral' } });
  if (typeof target.uploadUrl !== 'string' || typeof target.runwayUri !== 'string' || !target.runwayUri.startsWith('runway://')) throw Error('Runway returned an invalid upload target');
  const form = new FormData();
  for (const [name, value] of Object.entries(target.fields ?? {})) form.append(name, String(value));
  form.append('file', new Blob([media.bytes], { type: media.mimeType }), 'reference.' + extensionFor(media.mimeType));
  await send('Runway', target.uploadUrl, { method: 'POST', body: form, signal: api.signal, timeout: 300_000 });
  return target.runwayUri;
}

async function submit(api, binding, body) {
  const data = await api.call(binding.path, { method: 'POST', body });
  if (typeof data.id !== 'string' || !/^[\w-]{8,64}$/.test(data.id)) throw Error('Runway returned an invalid task ID');
  return data.id;
}

async function poll(api, id) {
  const task = await api.call('/v1/tasks/' + encodeURIComponent(id));
  const cost = Number.isFinite(task.cost?.credits) ? { state: 'captured', final: true, unit: 'credits', captured: task.cost.credits } : undefined;
  if (['PENDING', 'THROTTLED', 'RUNNING'].includes(task.status)) return { state: 'processing' };
  if (task.status === 'SUCCEEDED') return { state: 'succeeded', output: task.output, cost };
  return { state: 'failed', error: (task.failure ?? task.status ?? 'unknown status') + (task.failureCode ? ' (' + task.failureCode + ')' : ''), cost };
}

export const { createGeneration, checkStatus, testConnection } = catalogProvider({ prefix: 'rw', label: 'Runway', catalog, client, upload, submit, poll, test: api => api.call('/v1/organization') });
export const manifest = { id: 'runway', setupUrl: 'https://dev.runwayml.com', label: 'Runway', description: 'Runway Dev API: Gen-4.5, Veo 3.1, Seedance 2.5, Kling 4, Hailuo 3, Wan 3, MiniMax H3, Aleph video editing, Act-Two, image models and upscaling.', environment: ['RUNWAYML_API_SECRET'], models: catalog.models.map(entry => entry.model) };
