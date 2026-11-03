import { createHash } from 'node:crypto';
import { send, sendJson } from '../../kit/http.mjs';
import { credential } from '../../kit/polling.mjs';
import { catalogProvider, catalogModels } from '../../kit/catalog-provider.mjs';
import synced from './catalog.json' with { type: 'json' };
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

// Soul models take a trained Soul ID of their own version. The published schema types it as a UUID, which the generic
// converter skips, so it is added here as a text setting that Studio fills from the character library.
const SOUL_VERSIONS = { 'higgsfield-soul-2': 'v2', 'higgsfield-higgsfield-ai-soul-cinema': 'cinema' };
const catalog = { ...synced, models: synced.models.map(entry => {
  const version = SOUL_VERSIONS[entry.model.id];
  if (!version) return entry;
  const control = { key: 'custom_reference_id', label: 'Soul ID', type: 'string', default: '', maxLength: 64, identity: { family: 'higgsfield-soul', version }, description: 'A trained Soul ID (' + version + ') keeps this character\'s face and look' };
  return { model: { ...entry.model, controls: [...(entry.model.controls ?? []), control] }, binding: { ...entry.binding, controls: [...entry.binding.controls, { key: control.key, field: control.key }] } };
}) };
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

/** Checked before anything is uploaded or sent. The API accepts a strength of 0 with a Soul ID but cannot run it. */
function checkSoulId(options = {}) {
  const id = options.custom_reference_id;
  if (id === undefined || id === '') return;
  if (typeof id !== 'string' || !UUID.test(id.trim())) throw Error('A Soul ID looks like 3db34ab5-3439-4317-9e03-08dc30852e69');
  if (options.custom_reference_strength === 0) throw Error('Set the Soul ID strength above 0');
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
  // Higgsfield explains failures (for example a low credit balance) in `error`; pass it on so people can act on it.
  const reason = typeof data.error === 'string' && data.error.trim() ? data.error.trim().slice(0, 300).replace(/\.$/, '') : 'request ' + data.status;
  return { state: 'failed', error: reason };
}

/** A Soul ID trains from 1–100 images; training runs on Higgsfield and is billed to the account. */
export async function createIdentity({ name, version, images, configuration, signal }) {
  const api = client(configuration, signal);
  const urls = [];
  for (const image of images) urls.push(await upload(api, image));
  try { return identity(await api.call('/v1/custom-references', { method: 'POST', body: { name: String(name).slice(0, 100), model_version: version, input_images: urls.map(url => ({ type: 'image_url', image_url: url })) } })); }
  catch (error) {
    if (error?.status === 429) throw Error('Higgsfield is already training as many Soul IDs as it allows at once. Try again in a few minutes; nothing was charged.');
    throw error;
  }
}
export async function checkIdentity({ referenceId, configuration, signal }) {
  if (!UUID.test(referenceId)) throw Error('This is not a Soul ID');
  return identity(await client(configuration, signal).call('/v1/custom-references/' + referenceId));
}
function identity(data) {
  if (!UUID.test(data?.id ?? '')) throw Error('Higgsfield did not return a Soul ID');
  const status = data.status === 'completed' ? 'ready' : data.status === 'failed' ? 'failed' : 'training';
  return { referenceId: data.id, status, ...(status === 'failed' && typeof data.fail_reason === 'string' && data.fail_reason.trim() ? { error: data.fail_reason.trim().slice(0, 300) } : {}) };
}

const provider = catalogProvider({ prefix: 'hf', label: 'Higgsfield', catalog, client, upload, submit, poll, test: api => api.call('/v1/custom-references/list?page=1&page_size=1') });
export const { checkStatus, testConnection } = provider;
export async function createGeneration(request) { checkSoulId(request?.input?.options); return provider.createGeneration(request); }
export const manifest = { id: 'higgsfield', setupUrl: 'https://console.higgsfield.ai', keyFormat: 'KEY_ID:KEY_SECRET',
  identityTraining: { family: 'higgsfield-soul', label: 'Soul ID', versions: [{ value: 'v2', label: 'Soul 2' }, { value: 'cinema', label: 'Soul Cinema' }], maxImages: 20 }, label: 'Higgsfield', description: 'Direct Higgsfield API: Soul, Cinema Studio, Ads Studio, Seedance 2.5 create/edit/extend, Kling 3 and O3, motion control, Wan 3, MiniMax H3, LTX 2.5 and Genjutsu.', environment: ['HIGGSFIELD_API_KEY'], models: catalogModels(catalog) };
