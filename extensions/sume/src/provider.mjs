import { createHash } from 'node:crypto';
import { reportedCost } from './cost.mjs';
import { checkModel } from './preflight.mjs';
import { client, mediaUrl, SumeError } from './client.mjs';
import { profileFor, buildPayload, uploadPayload } from './payload.mjs';
const nextPoll = new Map();
const jobId = value => { if (typeof value !== 'string' || !/^job_[A-Za-z0-9_-]{1,150}$/.test(value)) throw Error('Sume did not return a valid job ID'); return value; };
function defer(id, seconds = 2) {
  if (nextPoll.size >= 512) nextPoll.delete(nextPoll.keys().next().value);
  nextPoll.set(id, Date.now() + Math.max(2, Math.min(600, Number(seconds) || 2)) * 1000);
}
export async function testConnection({ configuration, signal }) {
  await client(configuration, signal).request('/v1/open/balance');
  return { ok: true };
}
export async function createGeneration({ model, input, configuration, signal, readMedia, requestKey }) {
  const profile = profileFor(model.id), payload = buildPayload(profile, input);
  if (typeof requestKey !== 'string' || !requestKey || requestKey.length > 200) throw Error('Sume requires a durable Viral Hit generation ID');
  const api = client(configuration, signal);
  await checkModel(api, profile, payload.body);
  const body = await uploadPayload(payload.body, reference => api.upload(reference, readMedia));
  const idempotencyKey = 'vh-' + createHash('sha256').update(requestKey + '\0' + model.id).digest('hex');
  // POST is deliberately single-attempt. A transport failure never triggers another paid submission.
  const data = await api.request(payload.path, body, idempotencyKey);
  const taskId = jobId(data.job?.id ?? data.request_id);
  defer(taskId, data.next_poll_after_seconds);
  return { status: 'processing', taskId, cost: reportedCost(data) };
}
export async function checkStatus({ model, taskId, configuration, signal }) {
  profileFor(model.id); jobId(taskId);
  if ((nextPoll.get(taskId) ?? 0) > Date.now()) return { status: 'processing', taskId };
  const api = client(configuration, signal);
  try {
    const data = await api.request('/v1/jobs/' + encodeURIComponent(taskId) + '/status');
    const status = data.sume_status ?? String(data.status).toLowerCase();
    if (['failed', 'canceled', 'cancelled'].includes(status)) { nextPoll.delete(taskId); return { status: 'failed', taskId, ...(data.job?.usage_summary ? { cost: reportedCost(data) } : {}), error: 'Sume job ' + taskId + ' ' + status + '. See Sume job history for details.' }; }
    if (status !== 'completed' || data.result_ready === false) { defer(taskId, data.next_poll_after_seconds); return { status: 'processing', taskId, ...(data.job?.usage_summary ? { cost: reportedCost(data) } : {}) }; }
    const output = await api.request('/v1/jobs/' + encodeURIComponent(taskId) + '/result');
    const artifacts = output.result?.artifacts;
    if (!Array.isArray(artifacts)) throw Error('Sume completed without a media artifact');
    const media = artifacts.filter(item => item.type === model.kind || item.content_type?.startsWith(model.kind + '/')).map(item => ({ url: mediaUrl(item.url) }));
    if (!media.length || media.length > 8) throw Error('Sume result has no matching media, or too many artifacts');
    nextPoll.delete(taskId);
    return { status: 'succeeded', taskId, media, ...(output.job?.usage_summary ? { cost: reportedCost(output) } : {}) };
  } catch (error) {
    if (error instanceof SumeError && (error.status === 409 || error.status === 429 || error.status >= 500)) { defer(taskId, error.retryAfter); return { status: 'processing', taskId }; }
    throw error;
  }
}
