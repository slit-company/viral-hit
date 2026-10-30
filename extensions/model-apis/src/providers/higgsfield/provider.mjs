import { createHash } from 'node:crypto';
import { send, sendJson } from '../../kit/http.mjs';
import { credential } from '../../kit/polling.mjs';
import { catalogProvider } from '../../kit/catalog-provider.mjs';
import catalog from './catalog.json' with { type: 'json' };
// Higgsfield API: https://docs.higgsfield.ai/llms-full.txt
const API = 'https://api.higgsfield.ai';
const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'audio/mpeg', 'audio/wav'];

const client = (configuration, signal) => {
  const key = credential(configuration, 'HIGGSFIELD_API_KEY', 'Higgsfield (KEY_ID:KEY_SECRET)', /^[^:\s]+:[^:\s]+$/);
  const call = (path, options = {}) => sendJson('Higgsfield', API + path, { ...options, signal, headers: { Authorization: 'Key ' + key, ...options.headers } });
  return { call, signal };
};

async function upload(api, media) {
  if (!UPLOAD_TYPES.includes(media.mimeType)) throw Error('Higgsfield accepts PNG, JPEG, WebP, GIF, MP4, MP3 or WAV references');
  const signed = await api.call('/files/generate-upload-url', { method: 'POST', body: { content_type: media.mimeType } });
  const destination = new URL(signed.upload_url ?? ''), publicUrl = new URL(signed.public_url ?? '');
  if (destination.protocol !== 'https:' || publicUrl.protocol !== 'https:' || !/\.amazonaws\.com$/.test(destination.hostname)) throw Error('Unexpected Higgsfield upload destination');
  const headers = {};
  for (const [name, value] of Object.entries(signed.upload_headers ?? {})) if (['content-type', 'x-amz-tagging'].includes(name.toLowerCase()) && typeof value === 'string' && !/[\r\n]/.test(value)) headers[name.toLowerCase()] = value;
  await send('Higgsfield', destination.href, { method: 'PUT', body: media.bytes, headers: { 'content-type': media.mimeType, ...headers }, signal: api.signal, timeout: 300_000 });
  return publicUrl.href;
}

async function submit(api, binding, body, key) {
  const idempotencyKey = 'vh-' + createHash('sha256').update(key).digest('hex');
  const data = await api.call('/' + binding.endpoint, { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } });
  if (typeof data.request_id !== 'string' || !/^[a-f\d-]{36}$/i.test(data.request_id)) throw Error('Higgsfield returned an invalid request ID');
  return data.request_id;
}

async function poll(api, id) {
  const data = await api.call('/requests/' + encodeURIComponent(id) + '/status');
  if (['queued', 'in_progress'].includes(data.status)) return { state: 'processing' };
  if (data.status === 'completed') return { state: 'succeeded', output: { images: data.images, video: data.video, audio: data.audio } };
  return { state: 'failed', error: 'request ' + data.status };
}

export const { createGeneration, checkStatus, testConnection } = catalogProvider({ prefix: 'hf', label: 'Higgsfield', catalog, client, upload, submit, poll, test: api => api.call('/v1/custom-references/list?page=1&page_size=1') });
export const manifest = { id: 'higgsfield', label: 'Higgsfield', description: 'Direct Higgsfield API: Soul, Cinema Studio, Ads Studio, Seedance 2.5 create/edit/extend, Kling 3 and O3, motion control, Wan 3, MiniMax H3, LTX 2.5 and Genjutsu.', environment: ['HIGGSFIELD_API_KEY'], models: catalog.models.map(entry => entry.model) };
