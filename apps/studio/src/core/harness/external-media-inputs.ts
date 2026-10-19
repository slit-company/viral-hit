import { externalCatalog, externalEnvelope, type ExternalEntry } from './external-catalog';
import { pointerParts, readPointer } from './bindings';
import { readProjectMediaInput } from './project-media-input';
import type { Plan, Json } from './durable';

const overlaps = (left: string, right: string) => {
  const a = pointerParts(left), b = pointerParts(right);
  return a.slice(0, Math.min(a.length, b.length)).every((part, index) => part === b[index]);
};
/** Admit selected assets now, or bind their complete identity from a durable materializer output. */
export async function pinExternalMediaInputs(plan: Plan, entries: ExternalEntry[] = externalCatalog(), signal = AbortSignal.timeout(30_000)): Promise<Plan> {
  const result = structuredClone(plan);
  for (const node of result.nodes) {
    const entry = entries.find(entry => entry.descriptor.operation === node.operation);
    if (!entry?.descriptor.assetInputs?.length) continue;
    const envelope = externalEnvelope.parse(node.input);
    if (envelope.assetPins) throw new Error('External media inputs were already pinned');
    envelope.assetPins = {};
    for (const input of entry.descriptor.assetInputs) {
      const target = `/payload${input.pointer}`;
      const bindings = (node.bindings ?? []).filter(binding => overlaps(binding.target, target));
      if (bindings.length) {
        const binding = bindings[0], source = result.nodes.find(source => source.id === binding.node);
        if (bindings.length !== 1 || binding.target !== target || binding.pointer !== '/assetId' || source?.operation !== 'asset.materialize' || !node.dependsOn?.includes(source.id)) throw new Error('Asset inputs may bind only to an explicit materializer dependency’s /assetId');
        if ((source.input as Record<string, Json>).kind !== input.kind) throw new Error('Materializer output kind does not match the adapter asset input');
        envelope.assetPins[input.id] = { projectId: null, assetId: null, kind: null, sha256: null, sizeBytes: null };
        for (const field of ['projectId', 'assetId', 'kind', 'sha256', 'sizeBytes']) {
          (node.bindings ??= []).push({ target: `/assetPins/${input.id}/${field}`, node: source.id, pointer: `/${field}` });
        }
      } else {
        const id = readPointer(envelope.payload, input.pointer);
        if (typeof id !== 'string') throw new Error('Select a project asset for the declared adapter input');
        const { bytes: _, mimeType: __, filename: ___, ...pin } = await readProjectMediaInput({ projectId: plan.projectId, assetId: id, kind: input.kind, maxBytes: input.maxBytes, signal });
        envelope.assetPins[input.id] = pin;
      }
    }
    node.input = envelope;
  }
  return result;
}
