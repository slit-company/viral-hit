import { installGenerationProviders } from '../generation-providers/installed/install.server';
import { findGenerationModelBinding } from '../generation-providers/catalog';
import { getGenerationProvider } from '../generation-providers/registry';
import { getGenerationModelDescriptor } from '../generation-providers/model-catalog';
import { resolveModelOptions } from '../generation-providers/model-controls';
import { preflightAssetFirstGeneration } from '../generation-providers/submit';
import { MAX_PROVIDER_MEDIA_BYTES, MAX_PROVIDER_TOTAL_MEDIA_BYTES } from '../generation-providers/local-reference';
import { generationModelInput, generationRequest, type GenerationModelInput } from './generation-contract';
import { verifyProjectMediaInput } from './project-media-input';
import { projectMediaPin } from './project-media-input-schema';
import { isAssetOperation, assetOperationKind } from './asset-operations';
import { pointerParts } from './bindings';
import type { Plan, Json } from './durable';

export function generationModelRuntime(modelId: string) {
  installGenerationProviders();
  const found = findGenerationModelBinding({ modelId }), descriptor = getGenerationModelDescriptor(modelId);
  const provider = found && getGenerationProvider(found.providerId);
  if (!found || !descriptor || !provider?.executionIdentity) throw Error('Choose an installed model with a durable runtime identity');
  if (provider.isConfigured?.() === false) throw Error('Configure the installed generation provider before queueing');
  return { found, descriptor, provider, digest: provider.executionIdentity() };
}

export function assertGenerationRuntime(input: GenerationModelInput) {
  if (!input.runtime) throw Error('Missing pinned generation runtime');
  const current = generationModelRuntime(input.modelId);
  if (current.digest !== input.runtime.digest || current.found.providerId !== input.runtime.providerId || current.found.binding.effectId !== input.runtime.effectId || current.descriptor.kind !== input.mode)
    throw Error('Generation code, model or configuration changed; restore the original runtime');
  return current;
}

/** Pin all fixed identities; only explicit upstream media, text and option values may be bound later. */
export async function pinGenerationModels(plan: Plan, signal = AbortSignal.timeout(60_000)): Promise<Plan> {
  const result = structuredClone(plan);
  for (const node of result.nodes.filter(node => node.operation === 'generation.model')) {
    const input = generationModelInput.parse(node.input);
    if (input.runtime || input.pins) throw Error('Generation runtime was already pinned');
    const current = generationModelRuntime(input.modelId);
    if (current.descriptor.kind !== input.mode) throw Error('Generation model kind does not match the recipe');
    input.runtime = { projectId: plan.projectId, providerId: current.found.providerId, effectId: current.found.binding.effectId, digest: current.digest };
    if (current.found.binding.controls || input.parameters.provider_options !== undefined)
      input.parameters.provider_options = resolveModelOptions(current.found.binding.controls, input.parameters.provider_options);
    input.pins = [];
    for (const binding of node.bindings ?? []) {
      const parts = pointerParts(binding.target);
      if (binding.target === '/prompt' || (parts[0] === 'parameters' && parts.length > 1)) continue;
      if (parts.length !== 3 || parts[0] !== 'references' || parts[2] !== 'assetId' || !/^(0|[1-9]\d*)$/.test(parts[1]) || !input.references[Number(parts[1])]) throw Error('Generation bindings may change prompt, option values or an explicit reference assetId only');
    }
    for (const [index, reference] of input.references.entries()) {
      const bindings = (node.bindings ?? []).filter(binding => binding.target === `/references/${index}/assetId`);
      if (bindings.length) {
        const binding = bindings[0], parent = result.nodes.find(candidate => candidate.id === binding.node);
        if (bindings.length !== 1 || binding.pointer !== '/assetId' || !parent || !node.dependsOn?.includes(parent.id) || !isAssetOperation(parent.operation, parent.input) || assetOperationKind(parent.operation, parent.input) !== reference.kind) throw Error('Generation references require a same-kind retained asset dependency');
        input.pins.push({ projectId: null, assetId: null, kind: null, sha256: null, sizeBytes: null });
        for (const field of ['projectId', 'assetId', 'kind', 'sha256', 'sizeBytes']) (node.bindings ??= []).push({ target: `/pins/${index}/${field}`, node: parent.id, pointer: `/${field}` });
      } else {
        const { mimeType: _, filename: __, ...pin } = await verifyProjectMediaInput({ projectId: plan.projectId, assetId: reference.assetId, kind: reference.kind, maxBytes: MAX_PROVIDER_MEDIA_BYTES, signal });
        input.pins.push(pin);
      }
    }
    if (!(node.bindings?.length)) await preflightAssetFirstGeneration(generationRequest(input));
    node.input = input as Json;
  }
  return result;
}

export async function verifyGenerationReferences(input: GenerationModelInput, signal: AbortSignal) {
  if (!input.runtime || !input.pins || input.pins.length !== input.references.length) throw Error('Generation reference identities are incomplete');
  let total = 0;
  for (const [index, reference] of input.references.entries()) {
    const pin = projectMediaPin.parse(input.pins[index]);
    total += pin.sizeBytes;
    if (total > MAX_PROVIDER_TOTAL_MEDIA_BYTES) throw Error('Generation references exceed 256 MiB');
    await verifyProjectMediaInput({ projectId: input.runtime.projectId, assetId: reference.assetId, kind: reference.kind, expected: pin, maxBytes: MAX_PROVIDER_MEDIA_BYTES, signal });
  }
}
