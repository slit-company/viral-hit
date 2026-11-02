export const API = 'https://api.comfy.org';
export const resultJsonLimit = kind => (kind === 'video' ? 128 : 96) * 1048576;
export class RouterError extends Error {
  constructor(status, type = '', retryAfter = 2) { super('Comfy Router request failed (HTTP ' + status + (type ? ', ' + type : '') + ')'); this.status = status; this.type = type; this.retryAfter = retryAfter; }
}
async function limitedBytes(response, limit, label) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw Error(label + ' exceeded ' + Math.round(limit / 1048576) + ' MiB'); }
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
export async function limitedJson(response, limit = 4_000_000) {
  const bytes = await limitedBytes(response, limit, 'Comfy Router response');
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
  async function request(method, path, body, idempotencyKey, timeoutMs = 30_000, responseLimit = 4_000_000) {
    const encoded = body ? JSON.stringify(body) : undefined;
    if (encoded && Buffer.byteLength(encoded) > 64 * 1048576) throw Error('Comfy Router input exceeded the 64 MiB local request limit. Use smaller reference files.');
    let response;
    try {
      response = await fetch(API + path, { method, redirect: 'error', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeoutMs)]), headers: { Authorization: 'Bearer ' + key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, ...(encoded ? { body: encoded } : {}) });
    } catch { throw new RouterError(0, 'network'); }
    if (!response.ok) {
      const type = (response.headers.get('x-comfy-error-type') ?? '').replace(/[^a-z_]/g, '').slice(0, 40);
      await response.body?.cancel();
      throw new RouterError(response.status, type, retrySeconds(response.headers));
    }
    return { status: response.status, headers: response.headers, data: response.status === 204 ? null : await limitedJson(response, responseLimit) };
  }
  return { request };
}
const privateHost = host => /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
/** Validates inline and downloaded media with the same byte signature check. */
export function mediaBytes(data, kind) {
  const sniff = data.subarray(0, 12);
  const type = sniff.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
    : sniff[0] === 0xff && sniff[1] === 0xd8 ? 'image/jpeg'
    : sniff.subarray(0, 4).toString() === 'RIFF' && sniff.subarray(8, 12).toString() === 'WEBP' ? 'image/webp'
    : sniff.subarray(4, 8).toString() === 'ftyp' ? 'video/mp4'
    : sniff.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) ? 'video/webm' : '';
  if (!type.startsWith(kind + '/')) throw Error('Comfy Router returned a file that is not supported ' + kind + ' media');
  return { data: new Uint8Array(data), mimeType: type };
}
export function inlineMedia(base64, kind, declaredType) {
  const limit = (kind === 'video' ? 96 : 64) * 1048576;
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(limit / 3) * 4) throw Error('Comfy Router inline media is empty or exceeds the local size limit');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  if (base64.length % 4 || /[^A-Za-z0-9+/=]/.test(base64) || (base64.indexOf('=') >= 0 && base64.indexOf('=') !== base64.length - padding)) throw Error('Comfy Router returned invalid base64 media');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > limit) throw Error('Comfy Router inline media exceeds the local size limit');
  const media = mediaBytes(bytes, kind);
  if (declaredType && declaredType.toLowerCase() !== media.mimeType) throw Error('Comfy Router inline media type does not match its bytes');
  return media;
}
/** Downloads a result promptly: Router media links expire within hours. Only public HTTPS URLs are fetched. */
export async function downloadMedia(url, kind, signal) {
  let target;
  try { target = new URL(url); } catch { throw Error('Comfy Router returned an invalid media URL'); }
  if (target.protocol !== 'https:' || target.username || target.password || privateHost(target.hostname)) throw Error('Comfy Router returned an unsupported media URL');
  const response = await fetch(target, { redirect: 'error', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(180_000)]) });
  if (!response.ok) { await response.body?.cancel(); throw Error('Result download failed (HTTP ' + response.status + ')'); }
  const data = await limitedBytes(response, kind === 'video' ? 512 * 1048576 : 64 * 1048576, 'Result media');
  return mediaBytes(data, kind);
}
