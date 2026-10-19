import { createHash } from 'node:crypto';
import { z } from 'zod';
import { binaryReceiptOutput, readBinaryReceipt, saveBinaryReceipt, ReceiptIntegrityError } from './binary-receipts';
import { MAX_REMOTE_MEDIA_BYTES } from './download-media';
import { fingerprint, RejectedSubmission, type Adapter, type Json } from './durable';

const nodeId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const workflowInput = z.object({
  connection: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  workflow: z.record(nodeId, z.object({ class_type: z.string().min(1).max(200), inputs: z.record(z.string(), z.json()), _meta: z.object({ title: z.string().max(500) }).optional() }).strict()).refine(graph => Object.keys(graph).length > 0 && Object.keys(graph).length <= 256, 'A workflow requires 1–256 nodes'),
  output: z.object({ nodeId, field: z.enum(['images', 'audio', 'gifs', 'videos']), index: z.number().int().min(0).max(255).default(0) }).strict(),
}).strict().refine(input => Object.hasOwn(input.workflow, input.output.nodeId), 'Output node is missing');

export function comfyWorkflowUrl(value = process.env.VIRAL_HIT_COMFYUI_URL): URL | null {
  if (!value?.trim()) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('ComfyUI URL must be HTTP(S), without credentials, query or fragment');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
export const connectionHash = (url: URL) => createHash('sha256').update(url.href).digest('hex');
const providerId = z.object({ promptId: z.string().uuid(), connection: z.string().regex(/^[a-f0-9]{64}$/), key: z.string().uuid() }).strict();
class WorkflowHttpError extends Error { constructor(readonly status: number) { super(`ComfyUI returned HTTP ${status}`); } }
async function boundedBody(response: Response, limit: number, signal: AbortSignal) {
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('ComfyUI response exceeds the size limit'); }
  if (!response.body) throw new Error('ComfyUI response has no body');
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) throw new Error('ComfyUI response exceeds the size limit'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}
function descriptor(raw: unknown) {
  return z.object({ filename: z.string().min(1).max(255), subfolder: z.string().max(2000).default(''), type: z.enum(['output', 'temp']) }).passthrough().superRefine((file, ctx) => {
    if (/[\\/\x00]/.test(file.filename) || file.filename === '.' || file.filename === '..' || /[\\\x00]/.test(file.subfolder) || file.subfolder.startsWith('/') || file.subfolder.split('/').some(part => part === '..' || part === '.')) ctx.addIssue({ code: 'custom', message: 'Unsafe workflow output path' });
  }).parse(raw);
}

/** Native ComfyUI: a supplied prompt_id is NOT an idempotency guarantee. Recovery only looks up the first submission. */
export function createComfyWorkflowAdapter(configuredUrl = () => comfyWorkflowUrl()): Adapter {
  function connection(id?: string) {
    const url = configuredUrl(); if (!url) throw new RejectedSubmission('Configure VIRAL_HIT_COMFYUI_URL on the server');
    if (id && providerId.parse(JSON.parse(id)).connection !== connectionHash(url)) throw new RejectedSubmission('ComfyUI connection changed since submission; restore the original connection to reconcile this job');
    return url;
  }
  async function request(base: URL, path: string, signal: AbortSignal, body?: unknown, limit = 8 * 1024 * 1024) {
    const response = await fetch(new URL(path, base), { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), 'Comfy-Usage-Source': 'viral-hit' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) { await response.body?.cancel(); throw new WorkflowHttpError(response.status); }
    return { bytes: await boundedBody(response, limit, signal), contentType: response.headers.get('content-type') ?? '' };
  }
  async function json(base: URL, path: string, signal: AbortSignal, body?: unknown): Promise<any> {
    return JSON.parse((await request(base, path, signal, body)).bytes.toString('utf8'));
  }
  const queueItems = (queue: any): unknown[][] => {
    if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error('Invalid ComfyUI queue response');
    return [...queue.queue_running, ...queue.queue_pending];
  };
  function owned(item: any, key: string, input: Json) {
    return Array.isArray(item) && item[3]?.viral_hit?.key === key && item[3]?.viral_hit?.fingerprint === fingerprint(input);
  }
  return {
    recovery: 'reconcile',
    async submit(raw, context) {
      const parsed = workflowInput.safeParse(raw);
      if (!parsed.success) throw new RejectedSubmission('Invalid ComfyUI API-format workflow or output selection');
      const input = parsed.data, base = connection();
      if (input.connection && input.connection !== connectionHash(base)) throw new RejectedSubmission('Workflow inputs belong to a different ComfyUI connection');
      try {
        const result = await json(base, 'prompt', context.signal, { prompt: input.workflow, prompt_id: context.key, client_id: context.key, extra_data: { viral_hit: { key: context.key, fingerprint: fingerprint(raw) } } });
        const promptId = z.string().uuid().parse(result.prompt_id);
        return { id: JSON.stringify({ promptId, connection: connectionHash(base), key: context.key }) };
      } catch (error) {
        if (error instanceof WorkflowHttpError && [400, 401, 403, 404, 422].includes(error.status)) throw new RejectedSubmission(`ComfyUI rejected this workflow (${error.status}); verify installed nodes, models and inputs`);
        throw new Error('ComfyUI submission response was not confirmed; recovery will inspect history and queue without resubmitting');
      }
    },
    async reconcile(input, context) {
      const base = connection();
      const history = await json(base, `history/${encodeURIComponent(context.key)}`, context.signal);
      for (const [id, record] of Object.entries(history)) if (owned((record as any).prompt, context.key, input)) return { id: JSON.stringify({ promptId: z.string().uuid().parse(id), connection: connectionHash(base), key: context.key }) };
      const queue = queueItems(await json(base, 'queue', context.signal));
      const match = queue.find(item => owned(item, context.key, input));
      if (match) return { id: JSON.stringify({ promptId: z.string().uuid().parse(match[1]), connection: connectionHash(base), key: context.key }) };
      // Older servers may ignore supplied prompt_id. Check a bounded history window by our ownership marker.
      const recent = await json(base, 'history?max_items=200', context.signal);
      for (const [id, record] of Object.entries(recent)) if (owned((record as any).prompt, context.key, input)) return { id: JSON.stringify({ promptId: z.string().uuid().parse(id), connection: connectionHash(base), key: context.key }) };
      return null;
    },
    async poll(id, raw, signal, context) {
      const input = workflowInput.parse(raw), base = connection(id), { promptId, key } = providerId.parse(JSON.parse(id));
      if (!context) return { state: 'failed', error: 'ComfyUI output requires project execution context' };
      try {
        const saved = await readBinaryReceipt(context, signal);
        if (saved) {
          if (saved.receipt.provider !== 'comfy-workflow' || saved.receipt.providerJobId !== id) return { state: 'failed', error: 'Saved workflow receipt belongs to a different job' };
          return { state: 'succeeded', output: binaryReceiptOutput(saved.receipt) };
        }
        const history = await json(base, `history/${promptId}`, signal), item = history[promptId];
        if (!item) {
          const queued = queueItems(await json(base, 'queue', signal)).find(entry => entry[1] === promptId);
          if (queued && owned(queued, key, raw)) return { state: 'running', retryAfterMs: 2000 };
          return { state: 'uncertain', error: 'ComfyUI no longer reports this job in queue or history. Find the original job after restoring history; no resubmission was made.' };
        }
        if (!owned(item.prompt, key, raw)) return { state: 'failed', error: 'ComfyUI history ownership does not match this workflow' };
        if (item.status?.status_str === 'error') return { state: item.status?.messages?.some((message: any) => message[0] === 'execution_interrupted') ? 'canceled' : 'failed', error: 'ComfyUI workflow did not complete successfully; inspect its execution history' };
        if (item.status?.completed !== true || item.status?.status_str !== 'success') return { state: 'running', retryAfterMs: 2000 };
        const file = descriptor(item.outputs?.[input.output.nodeId]?.[input.output.field]?.[input.output.index]);
        const query = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
        const result = await request(base, `view?${query}`, signal, undefined, MAX_REMOTE_MEDIA_BYTES);
        const savedReceipt = await saveBinaryReceipt(context, { provider: 'comfy-workflow', model: 'comfyui/workflow', providerJobId: id, requestId: promptId, contentType: result.contentType, creditsUsed: null, servingProvider: 'configured-comfyui', droppedParams: null }, result.bytes, signal);
        return { state: 'succeeded', output: binaryReceiptOutput(savedReceipt) };
      } catch (error) {
        if (error instanceof ReceiptIntegrityError || error instanceof z.ZodError) return { state: 'failed', error: 'ComfyUI output or saved receipt is invalid; original workflow was not repeated' };
        throw error;
      }
    },
    async cancel(id, _input, signal) {
      const base = connection(id), { promptId } = providerId.parse(JSON.parse(id));
      // The per-job endpoint fences running-job cancellation. Never fall back to the global /interrupt route.
      const result = await json(base, `api/jobs/${promptId}/cancel`, signal, {});
      if (result.cancelled === true) {
        const history = await json(base, `history/${promptId}`, signal);
        const queue = queueItems(await json(base, 'queue', signal));
        if (!history[promptId] && !queue.some(item => item[1] === promptId)) return { state: 'canceled' };
      }
    },
  };
}
