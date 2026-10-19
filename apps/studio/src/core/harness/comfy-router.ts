import { comfy } from '@comfyorg/sdk';
import { z } from 'zod';
import { binaryReceiptOutput, readBinaryReceipt, saveBinaryReceipt, ReceiptIntegrityError } from './binary-receipts';
import { RejectedSubmission, type Adapter, type Json } from './durable';

export const routerInput = z.object({
  model: z.string().regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/),
  body: z.record(z.string(), z.json()),
}).strict();

/** Router only. Comfy Cloud workflow submit has a different idempotency contract. */
export function createComfyRouterAdapter(models = comfy.models): Adapter {
  return {
    recovery: 'replay',
    async submit(input, { key, signal }) {
      const parsed = routerInput.safeParse(input);
      if (!parsed.success) throw new RejectedSubmission('Invalid Comfy Router model or native input body');
      try {
        const handle = await models.submit(parsed.data.model, parsed.data.body, { idempotencyKey: key, signal, timeoutMs: 55_000, retry: false });
        return { id: handle.requestId };
      } catch (error) {
        const status = (error as { httpStatus?: number })?.httpStatus;
        if (status && [400, 401, 402, 403, 404, 422].includes(status)) {
          throw new RejectedSubmission(`Comfy rejected the submission (${status}); inspect model inputs, access and credits.`);
        }
        // Preserve the key in our ledger. A later worker replays this SAME submission.
        throw new Error('Comfy submission response was not confirmed; the same request key will be used for recovery.');
      }
    },
    async poll(id, input, signal, context) {
      const { model } = routerInput.parse(input);
      if (context) {
        try {
          const saved = await readBinaryReceipt(context, signal);
          if (saved) {
            if (saved.receipt.model !== model || saved.receipt.providerJobId !== id) return { state: 'failed', error: 'Saved provider receipt does not match this job' };
            return { state: 'succeeded', output: binaryReceiptOutput(saved.receipt) };
          }
        } catch (error) {
          if (error instanceof ReceiptIntegrityError) return { state: 'failed', error: error.message };
          throw error;
        }
      }
      const handle = models.handle(model, id);
      const status = await handle.status({ signal });
      if (!status.completed) return { state: 'running', retryAfterMs: status.retryAfterMs ?? 2000 };
      if (status.errorType) return {
        state: /cancel/i.test(status.errorType) ? 'canceled' : 'failed',
        error: `Comfy completed with ${status.errorType}`,
      };
      const result = await handle.get({ signal, timeoutMs: 50_000 });
      if (result.kind === 'binary') {
        if (!context) return { state: 'failed', error: 'Binary output requires project execution context' };
        try {
          const saved = await saveBinaryReceipt(context, {
            provider: 'comfy-router', model, providerJobId: id, requestId: result.requestId,
            contentType: result.contentType, creditsUsed: result.creditsUsed ?? null,
            servingProvider: result.servingProvider ?? null, droppedParams: result.droppedParams ? [...result.droppedParams] : null,
          }, result.data, signal);
          return { state: 'succeeded', output: binaryReceiptOutput(saved) };
        } catch (error) {
          if (error instanceof ReceiptIntegrityError) return { state: 'failed', error: error.message };
          throw error;
        }
      }
      return { state: 'succeeded', output: {
        provider: 'comfy-router', model, requestId: result.requestId,
        data: JSON.parse(JSON.stringify(result.data)) as Json,
        creditsUsed: result.creditsUsed ?? null, servingProvider: result.servingProvider ?? null, droppedParams: result.droppedParams ? [...result.droppedParams] : null,
        // The native receipt is durable; remote media URLs still need local materialization.
        mediaMaterialized: false,
      } };
    },
    async cancel(id, input, signal) {
      const { model } = routerInput.parse(input);
      await models.handle(model, id).cancel({ signal });
    },
  };
}

export const isComfyConfigured = () => Boolean(process.env.COMFY_API_KEY?.trim());
