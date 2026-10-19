import { z } from 'zod';
import { externalCatalog, externalConfigured, externalConfigurationDigest, externalEnvelope, validateExternalInput, type ExternalEntry } from './external-catalog';
import { binaryReceiptOutput, readBinaryReceipt, saveBinaryReceipt } from './binary-receipts';
import type { Adapter, Json } from './durable';

const pollResult = z.object({ state: z.enum(['running', 'succeeded', 'failed', 'canceled', 'uncertain']), output: z.json().optional(), error: z.string().max(8000).optional(), retryAfterMs: z.number().finite().nonnegative().optional() }).strict();
const binaryDetails = z.object({ model: z.string().min(1).max(200), providerJobId: z.string().min(1).max(1000), contentType: z.string().min(1).max(1000), creditsUsed: z.string().max(200).nullable().default(null) }).strict();

export function createExternalAdapter(entry: ExternalEntry): Adapter {
  let loaded: Promise<Adapter> | undefined;
  function payload(raw: Json) {
    const parsed = externalEnvelope.safeParse(raw);
    // Ordinary errors preserve ambiguous outcomes: never turn a changed runtime into a retryable rejection.
    if (!parsed.success || parsed.data.adapter.digest !== entry.digest || parsed.data.adapter.configuration !== externalConfigurationDigest(entry) || !externalConfigured(entry)) throw new Error(`External adapter changed or was not pinned: ${entry.descriptor.operation}. Restore the original runtime/configuration to inspect this job.`);
    validateExternalInput(entry, parsed.data.payload);
    return parsed.data.payload;
  }
  async function implementation() {
    loaded ??= (async () => {
      // Import exactly the verified bytes, not a mutable file path. Bundle dependencies; node: imports work.
      const url = `data:text/javascript;base64,${Buffer.from(entry.source).toString('base64')}`;
      const module = await import(/* @vite-ignore */ url);
      const adapter = module.default;
      if (!adapter || adapter.recovery !== entry.descriptor.recovery || typeof adapter.submit !== 'function' || typeof adapter.poll !== 'function' || (adapter.cancel !== undefined && typeof adapter.cancel !== 'function') || (entry.descriptor.recovery === 'reconcile' && typeof adapter.reconcile !== 'function')) throw new Error('External adapter module does not match its declared contract');
      return adapter as Adapter;
    })();
    return loaded;
  }
  function mediaContext(context: { projectId?: string; jobId?: string }, signal: AbortSignal) {
    const scoped = () => {
      if (!context.projectId || !context.jobId) throw new Error('Binary outputs require project/job context');
      return { projectId: context.projectId, jobId: context.jobId };
    };
    return {
      async readBinary() {
        const result = await readBinaryReceipt(scoped(), signal);
        if (!result) return null;
        if (result.receipt.provider !== 'external-adapter' || result.receipt.adapterDigest !== entry.digest) throw new Error('Binary receipt belongs to a different adapter');
        return binaryReceiptOutput(result.receipt);
      },
      async publishBinary(bytes: Uint8Array, details: unknown) {
        const parsed = binaryDetails.parse(details);
        const receipt = await saveBinaryReceipt(scoped(), { ...parsed, provider: 'external-adapter', adapterDigest: entry.digest,
          servingProvider: entry.descriptor.operation, requestId: null, droppedParams: null }, bytes, signal);
        return binaryReceiptOutput(receipt);
      },
    };
  }
  return {
    recovery: entry.descriptor.recovery,
    async submit(raw, context) {
      const input = payload(raw), adapter = await implementation();
      return z.object({ id: z.string().min(1).max(16_000) }).strict().parse(await adapter.submit(input, { ...context, ...mediaContext(context, context.signal) }));
    },
    async poll(id, raw, signal, context) {
      const input = payload(raw), adapter = await implementation();
      const result = await adapter.poll(id, input, signal, context ? { ...context, ...mediaContext(context, signal) } : undefined);
      if (Buffer.byteLength(JSON.stringify(result) ?? '') > 1_000_000) throw new Error('External adapter result exceeds 1 MB; publish media as binary');
      return pollResult.parse(result);
    },
    ...(entry.descriptor.recovery === 'reconcile' ? { async reconcile(raw: Json, context: Parameters<NonNullable<Adapter['reconcile']>>[1]) {
      const input = payload(raw), adapter = await implementation();
      return z.object({ id: z.string().min(1).max(16_000) }).strict().nullable().parse(await adapter.reconcile!(input, context));
    } } : {}),
    async cancel(id, raw, signal) {
      const input = payload(raw), adapter = await implementation();
      if (!adapter.cancel) throw new Error('External adapter cancellation is unsupported');
      const result = await adapter.cancel(id, input, signal);
      return result === undefined ? undefined : z.object({ state: z.literal('canceled') }).strict().parse(result);
    },
  };
}
export function createExternalAdapters() { return Object.fromEntries(externalCatalog().map(entry => [entry.descriptor.operation, createExternalAdapter(entry)])); }
