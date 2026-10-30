import { mediaHosts } from './profiles.mjs';
export const API = 'https://api.higgsfield.ai';
export class ApiError extends Error {
  constructor(status, retryAfter = 2) { super('Higgsfield request failed (HTTP ' + status + ')'); this.status = status; this.retryAfter = retryAfter; }
}
export async function limitedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Higgsfield returned an empty response');
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > 2_000_000) throw Error('Higgsfield response exceeded 2 MB'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { const data = JSON.parse(Buffer.concat(chunks).toString()); if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error(); return data; }
  catch { throw Error('Higgsfield returned invalid JSON'); }
}
function secureUrl(value) {
  let url; try { url = new URL(value); } catch { throw Error('Invalid Higgsfield media URL'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw Error('Unsupported Higgsfield URL');
  return url;
}
export function mediaUrl(value) {
  const url = secureUrl(value);
  if (!mediaHosts.includes(url.hostname)) throw Error('Higgsfield returned an unregistered media host. Review the provider mediaHosts before retrying result retrieval.');
  return url.href;
}
export function client(configuration, signal) {
  const key = configuration?.HIGGSFIELD_API_KEY?.trim();
  if (!key || !/^[^:\s]+:[^:\s]+$/.test(key)) throw Error('Connect your Higgsfield API credential in KEY_ID:KEY_SECRET format');
  const request = async (path, body, requestKey) => {
    if (!/^\/[a-zA-Z0-9/?=&._-]+$/.test(path) || path.startsWith('//')) throw Error('Invalid Higgsfield API path');
    let response;
    try {
      response = await fetch(API + path, { method: body ? 'POST' : 'GET', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(30_000)]), redirect: 'error', headers: { Authorization: 'Key ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(requestKey ? { 'Idempotency-Key': requestKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new ApiError(0); }
    if (!response.ok) {
      await response.body?.cancel();
      const retry = response.headers.get('retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 2;
      throw new ApiError(response.status, Math.max(2, Math.min(600, seconds || 2)));
    }
    return limitedJson(response);
  };
  return { request, async upload(reference, readMedia) {
    if (typeof readMedia !== 'function') throw Error('Use an imported project asset as the reference');
    const media = await readMedia(reference), bytes = media.bytes;
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 64 * 1024 * 1024) throw Error('Reference must contain 1 byte to 64 MiB');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4'].includes(media.mimeType)) throw Error('Use a PNG, JPEG, WebP, GIF or MP4 reference');
    const signed = await request('/files/generate-upload-url', { content_type: media.mimeType });
    const publicUrl = mediaUrl(signed.public_url), destination = secureUrl(signed.upload_url);
    if (!/^[a-z0-9][a-z0-9.-]*\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(destination.hostname)) throw Error('Unsupported Higgsfield upload destination');
    const headers = {};
    for (const [name, value] of Object.entries(signed.upload_headers ?? {})) {
      const normalized = name.toLowerCase();
      if (!['content-type', 'x-amz-tagging'].includes(normalized) || typeof value !== 'string' || /[\r\n]/.test(value)) throw Error('Unexpected signed upload header');
      headers[normalized] = value;
    }
    if (headers['content-type'] !== media.mimeType) throw Error('Upload metadata does not match the project asset');
    const response = await fetch(destination, { method: 'PUT', body: bytes, headers, signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(120_000)]), redirect: 'error' });
    await response.body?.cancel();
    if (!response.ok) throw Error('Higgsfield reference upload failed (HTTP ' + response.status + ')');
    return publicUrl;
  } };
}
