import { createHash } from 'node:crypto';
import { client, downloadMedia, modelPath, RouterError } from './client.mjs';
import { buildBody, checkInput, outputUrl, profileFor } from './profiles.mjs';
const nextPoll = new Map(), pending = new Map();
const QUEUE = 'q:', SYNC = 's:';
const requestIdOk = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,180}$/.test(value);
const TERMINAL = ['content_policy_violation', 'invalid_input', 'insufficient_credits', 'result_expired', 'request_not_found', 'cancelled', 'model_not_found', 'unauthorized', 'forbidden'];
function defer(taskId, seconds = 2) {
  if (nextPoll.size >= 512) nextPoll.delete(nextPoll.keys().next().value);
  nextPoll.set(taskId, Date.now() + Math.max(2, Math.min(60, seconds)) * 1000);
}
function failed(taskId, why) {
  nextPoll.delete(taskId); pending.delete(taskId);
  return { status: 'failed', taskId, error: 'Comfy Router ' + why + '. See your Comfy usage history for details.' };
}
async function finish(profile, data, taskId, signal) {
  const media = await downloadMedia(outputUrl(profile, data), profile.kind, signal);
  nextPoll.delete(taskId); pending.delete(taskId);
  return { status: 'succeeded', taskId, media: [media] };
}
export async function testConnection({ configuration, signal }) {
  await client(configuration, signal).request('GET', '/v2/models?limit=1');
  return { ok: true };
}
export async function createGeneration({ model, input, configuration, signal, readMedia, requestKey }) {
  const profile = profileFor(model.id), checked = checkInput(profile, input);
  if (typeof requestKey !== 'string' || !requestKey || requestKey.length > 200) throw Error('Comfy Router requires a durable generation ID');
  const images = [];
  for (const reference of checked.images) {
    if (typeof readMedia !== 'function') throw Error('Use an imported project image as the reference');
    const media = await readMedia(reference);
    if (!(media.bytes instanceof Uint8Array) || !media.bytes.length || media.bytes.length > 20 * 1048576 || !/^image\/(png|jpeg|webp)$/.test(media.mimeType)) throw Error('Use PNG, JPEG or WebP references of at most 20 MiB');
    images.push({ base64: Buffer.from(media.bytes).toString('base64'), mimeType: media.mimeType });
  }
  const body = buildBody(profile, checked, images);
  const key = 'vh-' + createHash('sha256').update(requestKey + '\0' + model.id).digest('hex').slice(0, 48);
  const api = client(configuration, signal), path = modelPath(profile.upstreamModelId);
  try {
    // Queued submit. A lost response is recovered by replaying this same Idempotency-Key, never by a new one.
    const { data } = await api.request('POST', path + '/requests', body, key, 60_000);
    if (!requestIdOk(data?.request_id)) throw Error('Comfy Router accepted the request without a usable request ID. Check usage history before retrying.');
    const taskId = QUEUE + data.request_id;
    defer(taskId);
    return { status: 'processing', taskId, cost: { state: 'unknown', final: false } };
  } catch (error) {
    if (!(error instanceof RouterError)) throw error;
    if (error.type !== 'not_enabled') {
      if (error.status >= 400 && error.status < 500 && error.status !== 409 && error.status !== 429) throw error;
      throw Error('Comfy Router submission outcome is unknown (' + error.message + '). Check usage history before starting another generation.');
    }
  }
  // The queue is not enabled for this account. Use the synchronous route; a timeout is collected later with the same key.
  const taskId = SYNC + key;
  if (pending.size >= 64) pending.delete(pending.keys().next().value);
  pending.set(taskId, body);
  const result = await checkStatus({ model, taskId, configuration, signal });
  return result.status === 'processing' ? { ...result, cost: { state: 'unknown', final: false } } : result;
}
export async function checkStatus({ model, taskId, configuration, signal }) {
  const profile = profileFor(model.id);
  if (typeof taskId !== 'string' || !(taskId.startsWith(QUEUE) || taskId.startsWith(SYNC)) || !requestIdOk(taskId.slice(2))) throw Error('Invalid Comfy Router task ID');
  if ((nextPoll.get(taskId) ?? 0) > Date.now()) return { status: 'processing', taskId };
  const api = client(configuration, signal), path = modelPath(profile.upstreamModelId);
  try {
    if (taskId.startsWith(SYNC)) {
      const body = pending.get(taskId);
      if (!body) return failed(taskId, 'lost the synchronous request after a restart; its original run may still appear in usage history');
      const { data } = await api.request('POST', path, body, taskId.slice(2), 50_000);
      return await finish(profile, data, taskId, signal);
    }
    const id = encodeURIComponent(taskId.slice(2));
    const { data: status, headers } = await api.request('GET', path + '/requests/' + id + '/status');
    if (status?.status !== 'COMPLETED') { defer(taskId, Number(headers.get('retry-after')) || 3); return { status: 'processing', taskId }; }
    if (status.error_type) return failed(taskId, 'finished with ' + String(status.error_type).slice(0, 40));
    const { data, status: code } = await api.request('GET', path + '/requests/' + id, undefined, undefined, 60_000);
    if (code === 202) { defer(taskId); return { status: 'processing', taskId }; }
    if (data?.error_type) return failed(taskId, 'finished with ' + String(data.error_type).slice(0, 40));
    return await finish(profile, data, taskId, signal);
  } catch (error) {
    if (!(error instanceof RouterError)) throw error;
    if (TERMINAL.includes(error.type) || (!error.type && [400, 401, 402, 403, 404, 410, 422].includes(error.status))) return failed(taskId, 'rejected the request (' + (error.type || 'HTTP ' + error.status) + ')');
    defer(taskId, error.retryAfter);
    return { status: 'processing', taskId };
  }
}
