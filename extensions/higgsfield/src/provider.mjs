import { createHash } from 'node:crypto';
import { client, mediaUrl, ApiError, API } from './client.mjs';
import { profileFor, buildPayload } from './profiles.mjs';
const polls = new Map();
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
function statusPath(taskId) {
  // Persist the API's returned status URL as the task ID; it survives process restarts.
  const url = new URL(taskId);
  if (url.origin !== API || url.username || url.password || url.search || url.hash || !/^\/requests\/[a-f\d-]{36}\/status$/i.test(url.pathname) || !uuid(url.pathname.split('/')[2])) throw Error('Invalid Higgsfield status URL');
  return url.pathname;
}
function defer(taskId, minimum = 2) {
  const delay = Math.max(minimum, Math.min(10, (polls.get(taskId)?.delay ?? 1.333) * 1.5));
  if (polls.size >= 512) polls.delete(polls.keys().next().value);
  polls.set(taskId, { delay, until: Date.now() + delay * 1000 });
}
export async function testConnection({ configuration, signal }) {
  await client(configuration, signal).request('/v1/custom-references/list?page=1&page_size=1');
  return { ok: true };
}
export async function createGeneration({ model, input, configuration, signal, readMedia, requestKey }) {
  const profile = profileFor(model.id), body = buildPayload(model, input);
  if (typeof requestKey !== 'string' || !requestKey || requestKey.length > 200) throw Error('Higgsfield requires a durable generation ID');
  const api = client(configuration, signal);
  if (body.video_url) {
    body.video_url = await api.upload(body.video_url, readMedia);
    const uploaded = []; for (const reference of body.image_urls) uploaded.push(await api.upload(reference, readMedia));
    body.image_urls = uploaded;
  }
  let response;
  try {
    // No automatic paid retries, including uncertain transport/JSON/5xx responses.
    response = await api.request('/' + profile.upstreamModelId, body, 'vh-' + createHash('sha256').update(requestKey + '\0' + model.id).digest('hex'));
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
    throw Error('Higgsfield submission outcome is unknown. Check API request history before creating another generation.');
  }
  if (!uuid(response.request_id)) throw Error('Higgsfield returned an invalid request ID. Check API request history before resubmitting.');
  const taskId = response.status_url;
  if (typeof taskId !== 'string' || taskId.length > 200 || statusPath(taskId).split('/')[2] !== response.request_id) throw Error('Higgsfield returned an invalid status URL. Check API request history before resubmitting.');
  defer(taskId);
  return { status: 'processing', taskId, cost: { state: 'unknown', final: false } };
}
export async function checkStatus({ model, taskId, configuration, signal }) {
  const profile = profileFor(model.id), path = statusPath(taskId);
  if ((polls.get(taskId)?.until ?? 0) > Date.now()) return { status: 'processing', taskId };
  let result;
  try { result = await client(configuration, signal).request(path); }
  catch (error) {
    if (error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500)) { defer(taskId, error.retryAfter); return { status: 'processing', taskId }; }
    throw error;
  }
  if (result.request_id !== path.split('/')[2]) throw Error('Higgsfield returned a different request ID');
  if (['queued', 'in_progress'].includes(result.status)) { defer(taskId); return { status: 'processing', taskId }; }
  polls.delete(taskId);
  if (['failed', 'nsfw', 'canceled'].includes(result.status)) return { status: 'failed', taskId, error: 'Higgsfield request ' + result.status + '. See API request history for details.' };
  if (result.status !== 'completed') throw Error('Unknown Higgsfield request status');
  const outputs = profile.kind === 'image' ? result.images : [result.video];
  if (!Array.isArray(outputs) || !outputs.length || outputs.length > 8) throw Error('Higgsfield completed without matching output media');
  return { status: 'succeeded', taskId, media: outputs.map(output => ({ url: mediaUrl(output?.url) })) };
}
