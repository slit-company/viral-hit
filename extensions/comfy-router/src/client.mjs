export const API = 'https://api.comfy.org';
export class RouterError extends Error {
  constructor(status, type = '', retryAfter = 2) { super('Comfy Router request failed (HTTP ' + status + (type ? ', ' + type : '') + ')'); this.status = status; this.type = type; this.retryAfter = retryAfter; }
}
async function limitedBytes(response, limit, label) {
  const reader = response.body?.getReader();
  if (!reader) throw Error(label + ' was empty');
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > limit) throw Error(label + ' exceeded ' + Math.round(limit / 1048576) + ' MiB');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
export async function limitedJson(response) {
  const bytes = await limitedBytes(response, 4_000_000, 'Comfy Router response');
  try { return JSON.parse(bytes.toString()); } catch { throw Error('Comfy Router returned invalid JSON'); }
}
const retrySeconds = headers => { const value = headers.get('retry-after'); const seconds = value && /^\d+$/.test(value) ? Number(value) : 2; return Math.max(2, Math.min(60, seconds)); };
export function modelPath(upstreamModelId) {
  if (!/^[a-z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(upstreamModelId)) throw Error('Invalid Comfy Router model ID');
  return '/v2/models/' + upstreamModelId;
}
export function client(configuration, signal) {
  const key = configuration?.COMFY_API_KEY?.trim();
  if (!key || /\s/.test(key)) throw Error('Connect your Comfy API key first');
  async function request(method, path, body, idempotencyKey, timeoutMs = 30_000) {
    let response;
    try {
      response = await fetch(API + path, { method, redirect: 'error', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeoutMs)]), headers: { Authorization: 'Bearer ' + key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new RouterError(0, 'network'); }
    if (!response.ok) {
      const type = (response.headers.get('x-comfy-error-type') ?? '').replace(/[^a-z_]/g, '').slice(0, 40);
      await response.body?.cancel();
      throw new RouterError(response.status, type, retrySeconds(response.headers));
    }
    return { status: response.status, headers: response.headers, data: response.status === 204 ? null : await limitedJson(response) };
  }
  return { request };
}
const privateHost = host => /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
/** Downloads a result promptly: Router media links expire within hours. Only public HTTPS URLs are fetched. */
export async function downloadMedia(url, kind, signal) {
  let target;
  try { target = new URL(url); } catch { throw Error('Comfy Router returned an invalid media URL'); }
  if (target.protocol !== 'https:' || target.username || target.password || privateHost(target.hostname)) throw Error('Comfy Router returned an unsupported media URL');
  const response = await fetch(target, { redirect: 'error', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(180_000)]) });
  if (!response.ok) { await response.body?.cancel(); throw Error('Result download failed (HTTP ' + response.status + ')'); }
  const header = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const data = await limitedBytes(response, kind === 'video' ? 512 * 1048576 : 64 * 1048576, 'Result media');
  const sniff = data.subarray(0, 12);
  const mimeType = kind === 'video' ? (header === 'video/webm' ? 'video/webm' : 'video/mp4')
    : sniff[0] === 0x89 ? 'image/png' : sniff[0] === 0xff ? 'image/jpeg' : sniff.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : header;
  if (kind === 'video' && mimeType === 'video/mp4' && sniff.subarray(4, 8).toString() !== 'ftyp') throw Error('Comfy Router returned a file that is not MP4 video');
  if (!mimeType.startsWith(kind + '/')) throw Error('Comfy Router returned ' + (header || 'unknown media') + ' for a ' + kind + ' model');
  return { data: new Uint8Array(data), mimeType };
}
