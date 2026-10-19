import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { z } from 'zod';
import { getActiveProject } from '../projects/projects';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { LOCAL_PROJECT_ASSET_PROVIDER, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { comfyWorkflowUrl, connectionHash, workflowInput } from './comfy-workflow';
import { probeMedia } from './probe-media';
import { RejectedSubmission, type Adapter, type Plan } from './durable';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const uploadInput = z.object({ assetId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), sha256: hash.optional(), connection: hash.optional() }).strict();
const receiptSchema = z.object({ image: z.string(), sha256: hash, connection: hash, assetId: z.string(), projectId: z.string() }).strict();
const MAX_INPUT_BYTES = 32 * 1024 * 1024;

export async function readProjectInputImage(projectId: string, assetId: string, signal?: AbortSignal) {
  if (!await getActiveProject({ projectId })) throw new RejectedSubmission('Project is unavailable');
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || asset.type !== 'image' || asset.storageProvider !== LOCAL_PROJECT_ASSET_PROVIDER || !asset.sha256) throw new RejectedSubmission('Select a locally stored image belonging to this project');
  const file = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_INPUT_BYTES) throw new RejectedSubmission('Input image must be a regular file up to 32 MiB');
    const chunks: Buffer[] = []; let size = 0;
    for (;;) {
      signal?.throwIfAborted();
      const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_INPUT_BYTES + 1 - size));
      const { bytesRead } = await handle.read(buffer);
      if (!bytesRead) break;
      size += bytesRead; if (size > MAX_INPUT_BYTES) throw new RejectedSubmission('Input image exceeds 32 MiB');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    bytes = Buffer.concat(chunks, size);
  } finally { await handle.close(); }
  if (bytes.length > MAX_INPUT_BYTES || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new RejectedSubmission('Input image integrity check failed');
  const info = await probeMedia(file, 'image', signal ?? AbortSignal.timeout(15_000));
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(info.extension)) throw new RejectedSubmission('ComfyUI inputs support PNG, JPEG and WebP images');
  return { bytes, sha256: asset.sha256, extension: info.extension, mimeType: info.mimeType };
}

/** Resolve project membership and content identity before the plan is persisted. */
export async function pinProjectInputs(plan: Plan, configuredUrl = () => comfyWorkflowUrl()): Promise<Plan> {
  const result = structuredClone(plan);
  const native = result.nodes.some(node => ['comfy.upload', 'comfy.workflow'].includes(node.operation));
  const base = native ? configuredUrl() : null;
  if (native && !base) throw new RejectedSubmission('Connect a ComfyUI server in Runs → Connections, or set VIRAL_HIT_COMFYUI_URL');
  const pinnedConnection = base ? connectionHash(base) : null;
  for (const node of result.nodes) if (node.operation === 'comfy.workflow') {
    const input = workflowInput.parse(node.input);
    if (input.connection && input.connection !== pinnedConnection) throw new RejectedSubmission('ComfyUI connection changed');
    for (const binding of node.bindings ?? []) if (binding.target === '/connection' || binding.target.startsWith('/connection/')) {
      if (binding.target !== '/connection' || binding.pointer !== '/connection' || result.nodes.find(source => source.id === binding.node)?.operation !== 'comfy.upload') throw new RejectedSubmission('Workflow connection may only bind to a pinned image upload');
    }
    node.input = { ...input, connection: pinnedConnection };
  }
  for (const node of result.nodes) if (node.operation === 'comfy.upload') {
    if (node.bindings?.length) throw new RejectedSubmission('Input uploads require a selected project asset, not a dependency binding');
    const input = uploadInput.parse(node.input);
    const media = await readProjectInputImage(plan.projectId, input.assetId);
    const connection = pinnedConnection!;
    if (input.sha256 && input.sha256 !== media.sha256) throw new RejectedSubmission('Selected image content changed');
    if (input.connection && input.connection !== connection) throw new RejectedSubmission('ComfyUI connection changed');
    node.input = { assetId: input.assetId, sha256: media.sha256, connection };
  }
  return result;
}

/** Upload recovery reuses content-addressed bytes with overwrite disabled, independently of generation. */
export function createComfyUploadAdapter(configuredUrl = () => comfyWorkflowUrl()): Adapter {
  return {
    recovery: 'replay',
    async submit(raw, context) {
      const input = uploadInput.parse(raw), base = configuredUrl();
      if (!base || !input.connection || input.connection !== connectionHash(base)) throw new RejectedSubmission('ComfyUI input connection changed or was not pinned before enqueue');
      if (!context.projectId || !input.sha256) throw new RejectedSubmission('Input image requires a pinned project execution context');
      const media = await readProjectInputImage(context.projectId, input.assetId, context.signal);
      if (media.sha256 !== input.sha256) throw new RejectedSubmission('Input image changed after enqueue');
      const name = `${input.sha256}.${media.extension}`;
      const subfolder = `viral-hit/${createHash('sha256').update(context.projectId).digest('hex').slice(0, 24)}`;
      const form = new FormData();
      form.set('image', new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }), name);
      form.set('subfolder', subfolder); form.set('type', 'input'); form.set('overwrite', 'false');
      const response = await fetch(new URL('upload/image', base), { method: 'POST', body: form, redirect: 'error', signal: context.signal });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`ComfyUI image upload returned HTTP ${response.status}`); }
      if (Number(response.headers.get('content-length')) > 64_000) { await response.body?.cancel(); throw new Error('Upload response is too large'); }
      const reader = response.body?.getReader(); if (!reader) throw new Error('Empty upload response');
      let bytes = Buffer.alloc(0);
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; if (bytes.length + chunk.value.length > 64_000) throw new Error('Upload response is too large'); bytes = Buffer.concat([bytes, chunk.value]); } }
      finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const returned = JSON.parse(bytes.toString('utf8'));
      if (returned.name !== name || returned.subfolder !== subfolder || returned.type !== 'input') throw new RejectedSubmission('ComfyUI did not retain the expected content-addressed input filename');
      return { id: JSON.stringify({ image: `${subfolder}/${name}`, sha256: input.sha256, connection: input.connection, assetId: input.assetId, projectId: context.projectId }) };
    },
    async poll(id, raw, _signal, context) {
      const receipt = receiptSchema.parse(JSON.parse(id)), input = uploadInput.parse(raw), base = configuredUrl();
      if (!base || receipt.connection !== connectionHash(base) || receipt.connection !== input.connection || receipt.sha256 !== input.sha256 || receipt.assetId !== input.assetId || receipt.projectId !== context?.projectId) return { state: 'failed', error: 'ComfyUI input receipt does not match this execution' };
      return { state: 'succeeded', output: receipt };
    },
    async cancel() {},
  };
}
