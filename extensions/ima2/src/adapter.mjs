import { createHash } from 'node:crypto';

export const VERSION = '3.26.3';
export const PROVIDERS = ['api', 'oauth', 'grok-api', 'gemini-api', 'atlascloud', 'minimax', 'comfy'];
const MAX_IMAGE = 32 * 1024 * 1024;
const requestId = key => `vh_${createHash('sha256').update(key).digest('hex')}`;
const uncertain = error => ({ state: 'uncertain', error });

function configuration(env) {
  const url = new URL(env.VIRAL_HIT_IMA2_URL);
  // An explicit local server or HTTPS deployment; no discovery, credentials in URLs or redirects.
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))) {
    throw Error('Configure an ima2 HTTPS origin or a loopback HTTP origin');
  }
  const token = env.VIRAL_HIT_IMA2_TOKEN;
  if (token && (Buffer.byteLength(token) > 4096 || /[\r\n]/.test(token))) throw Error('Invalid ima2 token');
  return { origin: url.origin, headers: token ? { 'x-ima2-token': token } : {} };
}

async function bounded(response, limit) {
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`ima2 HTTP ${response.status}; inspect the original request before retrying`);
  }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw Error('ima2 response exceeds size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error('ima2 returned an empty body');
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw Error('ima2 response exceeds size limit');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks, length);
}

function client(env, fetcher, signal) {
  const { origin, headers } = configuration(env);
  async function get(path, options = {}, limit = 4 * 1024 * 1024) {
    const response = await fetcher(origin + path, {
      ...options, redirect: 'error', headers: { ...headers, ...options.headers },
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    });
    return bounded(response, limit);
  }
  return {
    get,
    async json(path, options) { return JSON.parse((await get(path, options)).toString('utf8')); },
  };
}

function validate(input) {
  if (!input || !PROVIDERS.includes(input.provider) || typeof input.model !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,139}$/.test(input.model) ||
    typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 16000 ||
    !['low', 'medium', 'high'].includes(input.quality) ||
    !['1024x1024', '1536x1024', '1024x1536'].includes(input.size)) throw Error('Invalid ima2 image input');
}

async function health(api) {
  const result = await api.json('/api/health');
  if (result.ok !== true || result.version !== VERSION) throw Error(`This adapter requires ima2-gen ${VERSION}`);
}

async function inspect(api, id, input) {
  const history = await api.json(`/api/history?limit=2&requestId=${encodeURIComponent(id)}`);
  if (!Array.isArray(history.items)) throw Error('Invalid ima2 history response');
  if (history.items.some(row => row.requestId !== id) || history.items.length > 1) throw Error('ima2 result identity is ambiguous');
  const image = history.items[0];
  if (image) {
    if (image.kind !== 'classic' || image.provider !== input.provider || image.model !== input.model ||
      image.prompt !== input.prompt || image.mediaType !== 'image' || image.refsCount !== (input.source ? 1 : 0)) {
      throw Error('ima2 result does not match the requested provider, model, prompt or reference count');
    }
    return { image };
  }
  const state = await api.json('/api/inflight?includeTerminal=1');
  if (!Array.isArray(state.jobs) || !Array.isArray(state.terminalJobs)) throw Error('Invalid ima2 job response');
  const matches = [...state.jobs, ...state.terminalJobs].filter(job => job.requestId === id);
  if (matches.length > 1) throw Error('ima2 job identity is ambiguous');
  const job = matches[0];
  // ima2's inflight record stores only the first 500 characters; history stores the full prompt.
  if (job && (job.kind !== 'classic' || job.meta?.model !== input.model || (job.prompt != null && job.prompt !== input.prompt.slice(0, 500)) ||
    job.meta?.refsCount !== (input.source ? 1 : 0))) throw Error('ima2 job does not match this request');
  return { job, active: Boolean(job && state.jobs.includes(job)) };
}

function mediaPath(filename) {
  if (typeof filename !== 'string' || filename.length > 512 ||
    !filename.split('/').every(part => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part)) ||
    !/\.(png|jpe?g|webp)$/i.test(filename)) throw Error('Invalid ima2 generated filename');
  return '/generated/' + filename.split('/').map(encodeURIComponent).join('/');
}

function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  throw Error('ima2 output is not PNG, JPEG or WebP');
}

export function createAdapter({ env = process.env, fetcher = fetch } = {}) {
  return {
    recovery: 'reconcile',
    async submit(input, context) {
      validate(input);
      const api = client(env, fetcher, context.signal);
      await health(api);
      const references = [];
      if (input.source) {
        const asset = await context.readAsset('source');
        if (asset.bytes.length > MAX_IMAGE) throw Error('Reference image exceeds 32 MiB');
        const bytes = Buffer.from(asset.bytes);
        references.push(`data:${imageType(bytes)};base64,${bytes.toString('base64')}`);
      }
      const id = requestId(context.key);
      const body = { requestId: id, async: true, provider: input.provider, model: input.model,
        prompt: input.prompt, quality: input.quality, size: input.size, references,
        n: 1, format: 'png', moderation: 'auto', mode: 'direct', webSearchEnabled: false };
      const result = await api.json('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify(body),
      });
      if (result.requestId !== id) throw Error('ima2 accepted without the original request ID');
      return { id };
    },
    async reconcile(input, context) {
      validate(input);
      const api = client(env, fetcher, context.signal);
      await health(api);
      const id = requestId(context.key);
      const result = await inspect(api, id, input);
      return result.image || result.job ? { id } : null;
    },
    async poll(id, input, signal, context) {
      const saved = await context.readBinary();
      if (saved) return { state: 'succeeded', output: saved };
      validate(input);
      if (!/^vh_[a-f0-9]{64}$/.test(id)) return uncertain('Invalid ima2 request ID');
      const api = client(env, fetcher, signal);
      await health(api);
      const { image, job, active } = await inspect(api, id, input);
      if (image) {
        const bytes = await api.get(mediaPath(image.filename), {}, MAX_IMAGE);
        const contentType = imageType(bytes);
        const output = await context.publishBinary(bytes, {
          model: `ima2/${image.provider}/${image.model}`, providerJobId: id, contentType, creditsUsed: null,
        });
        return { state: 'succeeded', output };
      }
      if (active) return { state: 'running', retryAfterMs: 5000 };
      if (job && ['canceled', 'cancelled'].includes(job.status)) return { state: 'canceled' };
      // History is cached for three seconds in ima2. Allow its completed image to appear.
      if (job && ['done', 'completed', 'complete'].includes(job.status) &&
        Number.isFinite(job.finishedAt) && Math.abs(Date.now() - job.finishedAt) < 30000) return { state: 'running', retryAfterMs: 5000 };
      return uncertain('ima2 has no recoverable image for this request. Inspect the original job; no generation was repeated.');
    },
    async cancel(id, _input, signal) {
      if (!/^vh_[a-f0-9]{64}$/.test(id)) throw Error('Invalid ima2 request ID');
      const api = client(env, fetcher, signal);
      await health(api);
      await api.json(`/api/inflight/${id}`, { method: 'DELETE' });
      // Abort acknowledgement is not proof of cancellation. The next poll decides.
    },
  };
}

export default createAdapter();
