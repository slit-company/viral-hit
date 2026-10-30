import { send, sendJson, ApiError } from '../../kit/http.mjs';
import { credential } from '../../kit/polling.mjs';
import { extensionFor } from '../../kit/media.mjs';
import { catalogProvider } from '../../kit/catalog-provider.mjs';
import catalog from './catalog.json' with { type: 'json' };
// fal queue API: https://fal.ai/docs/documentation/model-apis/inference/queue
const QUEUE = 'https://queue.fal.run/';

const client = (configuration, signal) => {
  const key = credential(configuration, 'FAL_KEY', 'fal', /^[^\s]{16,}$/);
  const call = (url, options = {}) => sendJson('fal', url, { ...options, signal, headers: { Authorization: 'Key ' + key, ...options.headers } });
  return { call, signal };
};

async function upload(api, media) {
  // Same two-step upload the official fal client uses for files under 90 MB.
  const target = await api.call('https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', { method: 'POST', body: { content_type: media.mimeType, file_name: 'reference.' + extensionFor(media.mimeType) } });
  if (typeof target.upload_url !== 'string' || typeof target.file_url !== 'string' || !target.file_url.startsWith('https://')) throw Error('fal returned an invalid upload target');
  await send('fal', target.upload_url, { method: 'PUT', body: media.bytes, headers: { 'Content-Type': media.mimeType }, signal: api.signal, timeout: 300_000 });
  return target.file_url;
}

async function submit(api, binding, body) {
  const data = await api.call(QUEUE + binding.endpoint, { method: 'POST', body });
  const url = new URL(data.response_url ?? '');
  if (url.origin + '/' !== QUEUE || !/^\/[\w./-]+\/requests\/[\w-]{8,64}$/.test(url.pathname)) throw Error('fal returned an invalid request URL');
  return url.pathname.slice(1);
}

async function poll(api, path) {
  const status = await api.call(QUEUE + path + '/status');
  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') return { state: 'processing' };
  if (status.status !== 'COMPLETED') return { state: 'failed', error: 'unexpected status ' + status.status };
  if (status.error) return { state: 'failed', error: String(status.error).slice(0, 300) };
  try { return { state: 'succeeded', output: await api.call(QUEUE + path) }; }
  catch (error) { if (error instanceof ApiError && error.status === 422) return { state: 'failed', error: error.message }; throw error; }
}

async function test(api) {
  // A random request ID returns 404 for a valid key and 401/403 for an invalid one.
  try { await api.call(QUEUE + 'fal-ai/flux/requests/00000000-0000-4000-8000-000000000000/status'); }
  catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; }
}

export const { createGeneration, checkStatus, testConnection } = catalogProvider({ prefix: 'fal', label: 'fal', catalog, client, upload, submit, poll, test });
export const manifest = { id: 'fal', setupUrl: 'https://fal.ai/dashboard/keys', label: 'fal', description: 'fal model gallery: Nano Banana, GPT Image 2.5, FLUX 3, Seedream, Seedance 2.5, Kling 4, Gemini Omni, Wan 3, Grok, lip sync, upscaling, voice, music and sound.', environment: ['FAL_KEY'], models: catalog.models.map(entry => entry.model) };
