const API = 'https://api.sume.com';
export class SumeError extends Error {
  constructor(status, code, retryAfter = 0) { super('Sume request failed (' + status + (code ? ', ' + code : '') + ')'); this.status = status; this.retryAfter = retryAfter; }
}
export async function limitedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('Sume returned an empty response');
  const chunks = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > 2_000_000) throw Error('Sume response exceeded 2 MB'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Error('Sume returned invalid JSON'); }
}
export function mediaUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'media.sume.com' || url.port || url.username || url.password) throw Error('Sume returned an unsupported media host');
  return url.href;
}
export function client(configuration, signal) {
  const key = configuration?.SUME_API_KEY?.trim();
  if (!key || /[\r\n]/.test(key)) throw Error('Connect your Sume API key first');
  const request = async (path, body, requestKey) => {
    if (!/^\/v1\/[a-zA-Z0-9/?=&._%-]+$/.test(path)) throw Error('Invalid Sume API path');
    let response;
    try { response = await fetch(API + path, { method: body ? 'POST' : 'GET', signal, redirect: 'error', headers: { Authorization: 'Bearer ' + key, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(requestKey ? { 'Idempotency-Key': requestKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw Error(body ? 'Sume submission outcome is unknown. Check Sume job history before starting another generation.' : 'Could not reach Sume. Status checks can be retried.'); }
    if (!response.ok) {
      const data = await limitedJson(response).catch(() => ({}));
      const code = typeof data.error?.code === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(data.error.code) ? data.error.code : '';
      const retry = response.headers.get('retry-after');
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - Date.now()) / 1000) : 0;
      throw new SumeError(response.status, code, Math.min(600, Math.max(2, delay || 2)));
    }
    const json = await limitedJson(response);
    if (!json.data || typeof json.data !== 'object') throw Error('Sume returned an invalid data envelope');
    return json.data;
  };
  return { request, async upload(reference, readMedia) {
    if (typeof readMedia !== 'function') throw Error('Use an imported project asset as the reference');
    const media = await readMedia(reference);
    const bytes = media.bytes;
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 64 * 1024 * 1024) throw Error('Reference must contain at most 64 MiB');
    if (!/^(image|video|audio)\/[a-zA-Z0-9.+-]+$/.test(media.mimeType)) throw Error('Unsupported reference media type');
    const signed = await request('/v1/files/generate-upload-url', { content_type: media.mimeType, size_bytes: bytes.length, filename: 'reference.' + ({ image: 'png', video: 'mp4', audio: 'wav' }[media.kind] ?? 'bin') });
    const publicUrl = mediaUrl(signed.public_url), destination = new URL(signed.upload_url);
    if (destination.protocol !== 'https:' || !/^[a-z0-9-]+\.r2\.cloudflarestorage\.com$/.test(destination.hostname) || destination.port || destination.username || destination.password || signed.upload_method !== 'PUT') throw Error('Unsupported Sume upload destination');
    const headers = {};
    for (const [name, value] of Object.entries(signed.upload_headers ?? {})) {
      const normalized = name.toLowerCase();
      if (!['content-type', 'content-length'].includes(normalized) || typeof value !== 'string') throw Error('Unexpected signed upload header');
      headers[normalized] = value;
    }
    if (headers['content-type'] !== media.mimeType || (headers['content-length'] && Number(headers['content-length']) !== bytes.length)) throw Error('Upload metadata does not match the project asset');
    const response = await fetch(destination, { method: 'PUT', body: bytes, headers, signal, redirect: 'error' });
    await response.body?.cancel();
    if (!response.ok) throw Error('Sume reference upload failed (' + response.status + ')');
    return publicUrl;
  } };
}
