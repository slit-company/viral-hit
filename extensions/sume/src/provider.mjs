import { createHash } from 'node:crypto';
import { reportedCost } from './cost.mjs';
import { checkModel } from './preflight.mjs';
import { client, mediaUrl, SumeError } from './client.mjs';
import { profileFor, buildPayload, uploadPayload } from './payload.mjs';
import { mp4Seconds } from './mp4.mjs';
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
/** Read-only: the balance a model API key may spend, from the same route as the connection check. */
export async function checkBalance({ configuration, signal }) {
  const data = await client(configuration, signal).request('/v1/open/balance');
  const amount = typeof data.balance_usd_micros === 'number' ? data.balance_usd_micros / 1_000_000 : data.balance;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return { state: 'unknown', reason: 'Sume did not report a balance' };
  return { state: 'known', amount: Math.round(amount * 100) / 100, unit: typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) ? data.currency : 'USD' };
}
/** Reads each reference once, even when both the source length and the upload need it. */
function once(readMedia) {
  if (typeof readMedia !== 'function') return readMedia;
  const reads = new Map();
  return reference => { if (!reads.has(reference)) reads.set(reference, readMedia(reference)); return reads.get(reference); };
}
/** Genjutsu must be told the source clip's own length, rounded up; it is read from the file, never chosen. */
export async function sourceLength(profile, videoUrl, read) {
  if (typeof read !== 'function') throw Error('Use an imported project video as the source');
  const seconds = mp4Seconds((await read(videoUrl)).bytes);
  if (!seconds) throw Error('The source video length could not be read. Use an MP4 or MOV file.');
  const { shortest, longest } = profile.sourceVideo;
  if (seconds < shortest - 0.001 || seconds > longest + 0.001) throw Error(profile.name + ' needs a source clip of ' + shortest + '–' + longest + ' seconds; this one is ' + seconds.toFixed(1) + ' s. Trim it first.');
  return Math.max(shortest, Math.ceil(seconds - 0.001));
}
export async function createGeneration({ model, input, configuration, signal, readMedia, requestKey }) {
  const profile = profileFor(model.id), payload = buildPayload(profile, input);
  if (typeof requestKey !== 'string' || !requestKey || requestKey.length > 200) throw Error('Sume requires a durable Viral Hit generation ID');
  const read = once(readMedia);
  if (profile.sourceVideo) payload.body.duration = await sourceLength(profile, payload.body.video_url, read);
  const api = client(configuration, signal);
  await checkModel(api, profile, payload.body);
  const body = await uploadPayload(payload.body, reference => api.upload(reference, read));
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
    if (['failed', 'canceled', 'cancelled'].includes(status)) {
      nextPoll.delete(taskId);
      // Sume's own reason, such as a declined reference photo, shortened and with long tokens removed.
      const reason = typeof data.job?.error?.message === 'string' ? data.job.error.message.replace(/[A-Za-z0-9_-]{32,}/g, '[id]').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
      return { status: 'failed', taskId, ...(data.job?.usage_summary ? { cost: reportedCost(data) } : {}), error: reason ? 'Sume: ' + reason : 'Sume job ' + taskId + ' ' + status + '. See Sume job history for details.' };
    }
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
