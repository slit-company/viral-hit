import test from 'node:test';
import assert from 'node:assert/strict';
import { createComfyRouterAdapter, routerInput } from './comfy-router';
import { RejectedSubmission } from './durable';

const input = { model: 'bfl/flux-2-pro', body: { prompt: 'Original paper sculpture' } };
const signal = AbortSignal.timeout(1000);
const sdk = (patch: Record<string, unknown> = {}) => ({
  submit: async (_model: string, _body: unknown, options: { idempotencyKey: string }) => ({ requestId: options.idempotencyKey }),
  handle: () => ({ status: async () => ({ completed: true, status: 'COMPLETED' }), get: async () => ({ kind: 'json', data: { sample: 'https://example.org/image.png' }, requestId: 'r1', creditsUsed: '0.5' }), cancel: async () => {} }),
  ...patch,
}) as unknown as Parameters<typeof createComfyRouterAdapter>[0];

test('Router adapter forwards stable idempotency key and persists request and cost receipt', async () => {
  const adapter = createComfyRouterAdapter(sdk());
  assert.equal((await adapter.submit(input, { key: 'same-key', dependencies: {}, signal })).id, 'same-key');
  const result = await adapter.poll('r1', input, signal);
  assert.equal(result.state, 'succeeded');
  assert.equal((result.output as Record<string, unknown>).creditsUsed, '0.5');
  assert.equal((result.output as Record<string, unknown>).mediaMaterialized, false);
});
test('COMPLETED with an error is not success and does not fetch a result', async () => {
  let fetched = false;
  const adapter = createComfyRouterAdapter(sdk({ handle: () => ({ status: async () => ({ completed: true, errorType: 'cancelled' }), get: async () => { fetched = true; } }) }));
  assert.equal((await adapter.poll('r1', input, signal)).state, 'canceled'); assert.equal(fetched, false);
});
test('native schema rejects injected paths and unknown top-level credentials', () => {
  assert.equal(routerInput.safeParse({ ...input, model: '../../private' }).success, false);
  assert.equal(routerInput.safeParse({ ...input, apiKey: 'secret' }).success, false);
});
test('known rejection does not enter the ambiguous retry lane', async () => {
  const adapter = createComfyRouterAdapter(sdk({ submit: async () => { throw { httpStatus: 402 }; } }));
  await assert.rejects(adapter.submit(input, { key: 'a', dependencies: {}, signal }), RejectedSubmission);
});
