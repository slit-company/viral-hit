import { createHash } from 'node:crypto';
import { findGenerationIntentReceipt } from '../effects/generation-intent-receipt';
import { issueGenerationUploadIntent } from '../effects/generation-upload-intent';
import { syncGeneration } from '../effects/generation-sync';
import { preflightAssetFirstGeneration, submitAssetFirstGeneration } from '../generation-providers/submit';
import { generationModelInput, generationRequest, type GenerationModelInput } from './generation-contract';
import { assertGenerationRuntime, verifyGenerationReferences } from './generation-plan.server';
import { generationJobOutput } from './generation-output.server';
import { RejectedSubmission, type Adapter } from './durable';

/** One existing intent row per durable job key, including across process death before its receipt returns. */
export function modelGenerationIntentId(projectId: string, key: string) {
  const hash = createHash('sha256').update(JSON.stringify(['viral-hit-generation-v1', projectId, key])).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
async function receipt(input: GenerationModelInput, intentId: string) {
  if (!input.runtime) throw Error('Generation runtime was not pinned');
  const row = await findGenerationIntentReceipt({ projectId: input.runtime.projectId, intentId });
  if (!row) return null;
  if (row.intent.effectId !== input.runtime.effectId) throw Error('Generation intent model identity does not match this job');
  if (row.generation) {
    const stored = row.generation.input as { _runtimeIdentity?: string; _provider?: { id?: string; modelId?: string } } | null;
    if (stored?._runtimeIdentity !== input.runtime.digest || stored?._provider?.id !== input.runtime.providerId || stored?._provider?.modelId !== input.modelId)
      throw Error('Retained generation identity does not match this pinned job');
  }
  return row;
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Generation could not be inspected';

export function createGenerationModelAdapter(): Adapter {
  return {
    recovery: 'reconcile', execution: { timeoutMs: 300_000, abortOnCancel: false },
    async submit(raw, context) {
      const parsed = generationModelInput.safeParse(raw);
      if (!parsed.success) throw new RejectedSubmission('Resolved generation inputs do not match the model-step contract');
      const input = parsed.data;
      if (!input.runtime || context.projectId !== input.runtime.projectId || !context.jobId || !context.runId) throw new RejectedSubmission('Generation needs its original project execution context');
      const id = modelGenerationIntentId(input.runtime.projectId, context.key);
      // Even a pending reservation is observed rather than replayed after an interrupted attempt.
      if (await receipt(input, id)) return { id };
      let prepared: Awaited<ReturnType<typeof preflightAssetFirstGeneration>>;
      try {
        assertGenerationRuntime(input);
        await verifyGenerationReferences(input, context.signal);
        prepared = await preflightAssetFirstGeneration(generationRequest(input));
        context.signal.throwIfAborted();
      } catch (error) { throw new RejectedSubmission(message(error)); }
      // A unique deterministic ID fences two processes even if both saw the row as absent.
      await issueGenerationUploadIntent({ intentId: id, projectId: input.runtime.projectId, effectId: input.runtime.effectId, expectedUploadCount: prepared.expectedUploadCount });
      context.signal.throwIfAborted();
      await submitAssetFirstGeneration({ generation: prepared.generation, generationIntentId: id, origin: 'system', backgroundPolling: false, refreshExpiredIntent: false, expectedRuntimeIdentity: input.runtime.digest, executionSignal: context.signal });
      return { id };
    },
    async reconcile(raw, context) {
      const input = generationModelInput.parse(raw);
      if (!input.runtime) throw Error('Missing original generation runtime');
      const id = modelGenerationIntentId(input.runtime.projectId, context.key);
      context.signal.throwIfAborted();
      return await receipt(input, id) ? { id } : null;
    },
    async poll(id, raw, signal, context) {
      const input = generationModelInput.parse(raw);
      if (!input.runtime || context?.projectId !== input.runtime.projectId) return { state: 'uncertain', error: 'Generation project identity changed' };
      try {
        signal.throwIfAborted();
        let row = await receipt(input, id);
        if (!row?.generation) return { state: 'uncertain', error: 'Original generation has no retained receipt; no replacement was submitted' };
        if (['pending', 'processing'].includes(row.generation.status)) {
          if (!row.generation.providerTaskId) return { state: 'uncertain', error: 'Original provider submission has no task receipt yet; inspect and reconcile without resubmitting' };
          assertGenerationRuntime(input);
          await syncGeneration({ wmTaskId: row.generation.id, effectId: row.generation.effectId });
          row = await receipt(input, id);
        }
        const generation = row?.generation;
        if (!generation) return { state: 'uncertain', error: 'Original generation receipt is unavailable' };
        if (generation.status === 'failed') return { state: generation.providerTaskId ? 'failed' : 'uncertain', error: generation.error ?? 'Provider did not return a usable result; no replacement was submitted' };
        if (generation.status !== 'succeeded') return { state: 'running', retryAfterMs: 20_000 };
        return { state: 'succeeded', output: await generationJobOutput(input, generation, signal) };
      } catch (error) { return { state: 'uncertain', error: message(error) }; }
    },
    // Installed model APIs do not yet declare confirmed upstream cancellation.
  };
}
