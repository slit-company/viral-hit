import assert from 'node:assert/strict';
import test from 'node:test';
import { DurableHarness, type Adapter, type NodeSpec } from './durable';
import { createWorkerPool, jobResources, localJobLimit, WorkerSlots, workerLimits, type WorkerLimits } from './worker-pool.server';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const generation = (id: string, provider: string, project = 'film', extra: Partial<NodeSpec> = {}): NodeSpec =>
  ({ id, operation: 'generation.model', version: '1', input: { node: id, runtime: { providerId: provider, projectId: project } }, ...extra });

/** Records when each node starts and finishes and the peak number running per service. */
function timedAdapter(delayMs: (node: string) => number) {
  const active = new Map<string, number>(), peak = new Map<string, number>(), started = new Map<string, number>(), finished = new Map<string, number>();
  let clock = 0;
  const adapter: Adapter = { recovery: 'replay',
    async submit(raw, context) {
      const input = raw as { node: string; runtime?: { providerId: string } }, service = input.runtime?.providerId ?? 'local';
      active.set(service, (active.get(service) ?? 0) + 1);
      peak.set(service, Math.max(peak.get(service) ?? 0, active.get(service)!));
      started.set(input.node, ++clock);
      await wait(delayMs(input.node));
      active.set(service, active.get(service)! - 1);
      finished.set(input.node, ++clock);
      return { id: context.key };
    },
    async poll(id) { return { state: 'succeeded', output: { id } }; },
  };
  return { adapter, peak, started, finished };
}

async function drive(h: DurableHarness, pool: ReturnType<typeof createWorkerPool>, runs: string[]) {
  const failures: unknown[] = [];
  for (let i = 0; i < 2000 && !runs.every(run => h.jobs(run).every(job => job.state === 'succeeded')); i++) {
    pool.tick([], error => failures.push(error));
    await wait(2);
  }
  await pool.drain();
  assert.deepEqual(failures, []);
  for (const run of runs) assert.deepEqual(h.jobs(run).map(job => job.state), h.jobs(run).map(() => 'succeeded'));
}

const limits = (patch: Partial<WorkerLimits> = {}): WorkerLimits => ({ total: 8, perProvider: 2, perProject: 8, local: 1, ...patch });

test('slots reserve every resource or none and releases are idempotent', () => {
  const slots = new WorkerSlots(limits({ total: 3, perProject: 2 }));
  const first = slots.acquire(['provider:x', 'project:p'])!;
  assert.ok(slots.acquire(['provider:x', 'project:q']));
  assert.equal(slots.acquire(['provider:x', 'project:r']), null, 'service limit');
  assert.ok(slots.acquire(['local']));
  assert.equal(slots.acquire(['provider:y', 'project:p']), null, 'total limit');
  first(); first();
  assert.equal(slots.size, 2);
  assert.ok(slots.acquire(['provider:y', 'project:p']));
  assert.equal(slots.acquire(['local']), null, 'local limit');
});

test('steps map to their service, project or local capacity, and settings stay bounded', () => {
  const job = (operation: string, input: unknown = {}) => ({ operation, input_json: JSON.stringify(input), execution_input_json: null });
  assert.deepEqual(jobResources(job('generation.model', { runtime: { providerId: 'higgsfield', projectId: 'p1' } })), ['provider:higgsfield', 'project:p1']);
  assert.deepEqual(jobResources(job('comfy.router')), ['provider:comfy']);
  assert.deepEqual(jobResources(job('comfy.workflow')), ['provider:comfyui']);
  assert.deepEqual(jobResources(job('editor.sequence')), ['local']);
  assert.equal(localJobLimit(16, 64 * 1024 ** 3), 4);
  assert.equal(localJobLimit(10, 16 * 1024 ** 3), 2);
  assert.equal(localJobLimit(4, 8 * 1024 ** 3), 1);
  assert.deepEqual(workerLimits({ VIRAL_HIT_WORKER_CONCURRENCY: '100', VIRAL_HIT_PROVIDER_CONCURRENCY: '0', VIRAL_HIT_LOCAL_CONCURRENCY: '2' }), { total: 32, perProvider: 3, perProject: 3, local: 2 });
});

test('takes on one service run side by side up to its limit, after the keyframe they depend on', async () => {
  const h = new DurableHarness(':memory:'), timing = timedAdapter(() => 20);
  const run = h.enqueue({ projectId: 'film', nodes: [generation('still', 'hf'), ...[1, 2, 3, 4].map(n => generation('take-' + n, 'hf', 'film', { dependsOn: ['still'] }))] }, 'shot');
  await drive(h, createWorkerPool(h, { 'generation.model': timing.adapter }, limits()), [run]);
  assert.equal(timing.peak.get('hf'), 2);
  for (const n of [1, 2, 3, 4]) assert.ok(timing.started.get('take-' + n)! > timing.finished.get('still')!);
  h.close();
});

test('one project cannot take every generation slot, and a slow local step does not hold back other work', async () => {
  const h = new DurableHarness(':memory:'), timing = timedAdapter(node => node === 'render' ? 150 : 10);
  const slow = h.enqueue({ projectId: 'a', nodes: [{ id: 'render', operation: 'editor.sequence', version: '1', input: { node: 'render' } }] }, 'slow');
  const busy = h.enqueue({ projectId: 'b', nodes: [1, 2, 3].map(n => generation('b-' + n, 'xai', 'b')) }, 'busy');
  const other = h.enqueue({ projectId: 'c', nodes: [generation('c-1', 'xai', 'c')] }, 'other');
  const adapters = { 'generation.model': timing.adapter, 'editor.sequence': timing.adapter };
  await drive(h, createWorkerPool(h, adapters, limits({ perProvider: 4, perProject: 2 })), [slow, busy, other]);
  assert.ok(timing.finished.get('c-1')! < timing.finished.get('render')!, 'later runs progress while the render runs');
  assert.ok(timing.started.get('c-1')! < timing.started.get('b-3')!, 'project limit leaves room for another project');
  h.close();
});
