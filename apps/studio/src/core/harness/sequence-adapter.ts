import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeMedia } from './probe-media';
import { z } from 'zod';
import { sequenceSchema, inspectSequence, type SequenceMedia } from '../editor/sequence';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { projectMediaPin } from './project-media-input-schema';
import { readProjectMediaInput } from './project-media-input';
import { isAssetOperation, assetOperationKind } from './asset-operations';
import { pointerParts } from './bindings';
import { fingerprint, RejectedSubmission, type Adapter, type Plan } from './durable';

const pendingPin = z.object({ projectId: z.null(), assetId: z.null(), kind: z.null(), sha256: z.null(), sizeBytes: z.null() }).strict();
export const sequenceInput = sequenceSchema.safeExtend({ pins: z.record(z.string(), z.union([projectMediaPin, pendingPin])).optional() });
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const fields = ['projectId', 'assetId', 'kind', 'sha256', 'sizeBytes'] as const;

/** Bind complete materializer identities; planners cannot substitute unverified asset IDs later. */
export async function pinSequenceInputs(plan: Plan, signal = AbortSignal.timeout(30_000)): Promise<Plan> {
  const result = structuredClone(plan);
  for (const node of result.nodes.filter(node => node.operation === 'editor.sequence')) {
    const input = sequenceInput.parse(node.input);
    if (input.pins) throw Error('Sequence media was already pinned');
    input.pins = {};
    for (const binding of node.bindings ?? []) {
      const parts = pointerParts(binding.target);
      if (parts[0] === 'tracks' && parts.length >= 2) continue;
      if (parts.length !== 3 || parts[0] !== 'assets' || parts[2] !== 'assetId' || !Object.hasOwn(input.assets, parts[1])) throw Error('Sequence bindings may change clips or an explicit assetId only');
    }
    let total = 0;
    for (const [name, source] of Object.entries(input.assets)) {
      const bindings = (node.bindings ?? []).filter(binding => binding.target === `/assets/${name}/assetId`);
      if (bindings.length) {
        const binding = bindings[0], parent = result.nodes.find(candidate => candidate.id === binding.node);
        if (bindings.length !== 1 || binding.pointer !== '/assetId' || !parent || !node.dependsOn?.includes(parent.id) || !isAssetOperation(parent.operation, parent.input) || assetOperationKind(parent.operation, parent.input) !== source.kind) throw Error('Sequence asset bindings require a same-kind materializer dependency');
        input.pins[name] = { projectId: null, assetId: null, kind: null, sha256: null, sizeBytes: null };
        for (const field of fields) (node.bindings ??= []).push({ target: `/pins/${name}/${field}`, node: parent.id, pointer: `/${field}` });
      } else {
        const { bytes: _, mimeType: __, filename: ___, ...pin } = await readProjectMediaInput({ projectId: plan.projectId, assetId: source.assetId, kind: source.kind, maxBytes: MAX_SOURCE_BYTES, signal });
        input.pins[name] = pin; total += pin.sizeBytes;
      }
    }
    if (total > 512 * 1024 * 1024) throw Error('Sequence sources exceed 512 MiB');
    node.input = input;
  }
  return result;
}

export async function verifySequence(raw: unknown, projectId: string, signal: AbortSignal) {
  const input = sequenceInput.parse(raw), { pins, ...sequence } = input;
  if (!pins || Object.keys(pins).length !== Object.keys(sequence.assets).length) throw Error('Sequence needs complete media pins');
  let total = 0;
  const media: Record<string, SequenceMedia> = {};
  for (const [name, source] of Object.entries(sequence.assets)) {
    const expected = projectMediaPin.parse(pins[name]);
    total += expected.sizeBytes;
    if (total > 512 * 1024 * 1024) throw Error('Sequence sources exceed 512 MiB');
    const original = await readProjectMediaInput({ projectId, assetId: source.assetId, kind: source.kind, maxBytes: MAX_SOURCE_BYTES, expected, signal });
    const directory = await mkdtemp(join(tmpdir(), 'vh-sequence-probe-'));
    let duration: number | null;
    try {
      const file = join(directory, 'source.bin');
      await writeFile(file, original.bytes, { flag: 'wx', mode: 0o600 });
      const info = await probeMedia(file, source.kind, signal);
      duration = info.durationMs === null ? null : info.durationMs / 1000;
    } finally { await rm(directory, { recursive: true, force: true }); }
    const asset = await getProjectAssetById({ projectId, assetId: source.assetId });
    if (!asset) throw Error('Sequence asset is unavailable');
    media[name] = { assetId: asset.id, kind: asset.type, publicUrl: asset.publicUrl, name: asset.filename ?? name, duration };
  }
  return { sequence, media, digest: fingerprint(input), summary: inspectSequence(sequence, media, projectId) };
}

/** Preparing an edit never mutates a timeline or renders media. Acceptance is a separate command. */
export function createSequenceAdapter(): Adapter {
  return {
    recovery: 'replay', execution: { timeoutMs: 60000, abortOnCancel: true },
    async submit(raw, context) {
      if (!context.projectId) throw new RejectedSubmission('Sequence needs a project');
      try { const verified = await verifySequence(raw, context.projectId, context.signal); return { id: verified.digest }; }
      catch (error) { throw new RejectedSubmission(error instanceof Error ? error.message : 'Invalid sequence'); }
    },
    async poll(id, raw, signal, context) {
      try {
        if (!context?.projectId) throw Error('Sequence needs a project');
        const verified = await verifySequence(raw, context.projectId, signal);
        if (id !== verified.digest) throw Error('Sequence receipt does not match its input');
        return { state: 'succeeded', output: { sequenceReady: true, digest: id, ...verified.summary } };
      } catch (error) { return { state: 'failed', error: error instanceof Error ? error.message : 'Invalid sequence' }; }
    },
    async cancel() { return { state: 'canceled' }; },
  };
}
