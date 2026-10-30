// Small HTTP layer shared by every provider: bounded bodies, explicit timeouts, no automatic retries of paid calls.
export class ApiError extends Error {
  constructor(provider, status, detail = '', retryAfter = 2) {
    super(provider + ' request failed' + (status ? ' (HTTP ' + status + ')' : ' (network)') + (detail ? ': ' + detail : ''));
    this.status = status; this.retryAfter = retryAfter;
  }
}
export const isTransient = error => error instanceof ApiError && (error.status === 0 || error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500);

function retryAfter(header) {
  if (!header) return 2;
  const seconds = /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
  return Math.max(2, Math.min(600, seconds || 2));
}

async function readLimited(response, maxBytes, label) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw Error(label + ' response is larger than ' + Math.round(maxBytes / 1048576) + ' MiB');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new Uint8Array(Buffer.concat(chunks));
}

function errorDetail(bytes) {
  try {
    // Some APIs (Gemini) wrap the error object in a one-item array.
    const parsed = JSON.parse(Buffer.from(bytes).toString()), data = Array.isArray(parsed) ? parsed[0] : parsed;
    const message = data?.error?.message ?? data?.detail?.message ?? data?.message ?? data?.error ?? data?.detail ?? data?.failure ?? data?.base_resp?.status_msg;
    return typeof message === 'string' ? message.slice(0, 300) : Array.isArray(message) ? JSON.stringify(message).slice(0, 300) : '';
  } catch { return Buffer.from(bytes).toString().replace(/\s+/g, ' ').slice(0, 200); }
}

/** Sends one request. A network failure throws ApiError(status 0) and is never retried here. */
export async function send(provider, url, { method = 'GET', headers = {}, body, signal, timeout = 60_000, maxBytes = 4_000_000 } = {}) {
  let response;
  const json = body !== undefined && !(body instanceof FormData) && !(body instanceof Uint8Array);
  try {
    response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeout)]), headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: json ? JSON.stringify(body) : body } : {}) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(provider, 0);
  }
  const bytes = await readLimited(response, maxBytes, provider);
  if (!response.ok) throw new ApiError(provider, response.status, errorDetail(bytes), retryAfter(response.headers.get('retry-after')));
  return { bytes, type: response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '' };
}

export async function sendJson(provider, url, options) {
  const { bytes } = await send(provider, url, options);
  try {
    const data = JSON.parse(Buffer.from(bytes).toString());
    if (!data || typeof data !== 'object') throw Error();
    return data;
  } catch { throw Error(provider + ' returned invalid JSON'); }
}
