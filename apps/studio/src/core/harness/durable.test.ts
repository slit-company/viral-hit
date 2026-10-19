import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableHarness, compilePlan, RejectedSubmission, type Adapter, type Plan } from './durable';

const plan = (a = 'first'): Plan => ({ projectId: 'film', nodes: [
  { id: 'shot-a', operation: 'fixture', version: '1', input: { prompt: a }, cache: true },
  { id: 'shot-b', operation: 'fixture', version: '1', input: { prompt: 'second' }, cache: true },
  { id: 'edit', operation: 'fixture', version: '1', input: { title: 'Film' }, dependsOn: ['shot-a', 'shot-b'], cache: true },
] });
function fixture() {
  let calls = 0, polls = 0, cancellations = 0;
  const adapter: Adapter = { recovery: 'replay',
    async submit(_input, ctx) { calls++; return { id: ctx.key }; },
    async poll(id) { polls++; return { state: 'succeeded', output: { artifact: id } }; },
    async cancel() { cancellations++; },
  };
  return { adapter, counts: () => ({ calls, polls, cancellations }) };
}
async function drain(h: DurableHarness, run: string, adapter: Adapter) {
  for (let i = 0; i < 32; i++) { if (!(await h.step(run, { fixture: adapter }))) break; }
}

test('rejects cycles, duplicate nodes and missing dependencies before persistence', () => {
  assert.throws(() => compilePlan({ projectId: 'p', nodes: [{ id: 'a', operation: 'f', version: '1', input: {}, dependsOn: ['a'] }] }), /Cycle/);
  const p = plan(); p.nodes.push(p.nodes[0]); assert.throws(() => compilePlan(p), /duplicate/);
  const q = plan(); q.nodes[0].dependsOn = ['missing']; assert.throws(() => compilePlan(q), /Missing/);
});
test('input key order is irrelevant; model/version and upstream changes invalidate descendants only', () => {
  const a = compilePlan(plan()), b = compilePlan(plan('new'));
  assert.notEqual(a.get('shot-a'), b.get('shot-a')); assert.notEqual(a.get('edit'), b.get('edit'));
  assert.equal(a.get('shot-b'), b.get('shot-b'));
  const p = plan(); p.nodes[0].version = '2'; assert.notEqual(a.get('shot-a'), compilePlan(p).get('shot-a'));
});
test('shared cache ancestry in a large DAG is evaluated without exponential expansion', { timeout: 2000 }, () => {
  const h = new DurableHarness(':memory:');
  const nodes = Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, operation: 'fixture', version: '1', input: {}, cache: true, dependsOn: i < 2 ? [] : [`n${i-1}`, `n${i-2}`] }));
  assert.equal(h.jobs(h.enqueue({ projectId: 'p', nodes }, 'dense')).length, 80); h.close();
});
test('request idempotency survives process restart and rejects changed request body', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-')); const file = join(dir, 'state.db');
  let h = new DurableHarness(file); const id = h.enqueue(plan(), 'request'); h.close();
  h = new DurableHarness(file); assert.equal(h.enqueue(plan(), 'request'), id);
  assert.throws(() => h.enqueue(plan('changed'), 'request'), /different plan/);
  h.close(); rmSync(dir, { recursive: true });
});
test('selective recomputation reuses an unrelated accepted shot, not changed descendants', async () => {
  const h = new DurableHarness(':memory:'), f = fixture();
  await drain(h, h.enqueue(plan(), 'first'), f.adapter);
  const run = h.enqueue(plan('new'), 'revision');
  assert.deepEqual(h.jobs(run).map(j => [j.node_id, j.state]), [['shot-a', 'queued'], ['shot-b', 'succeeded'], ['edit', 'queued']]);
  await drain(h, run, f.adapter); assert.equal(f.counts().calls, 5);
  assert.ok(h.events(run).some(e => e.event === 'cache_hit')); h.close();
});
test('non-cacheable stochastic generation invalidates downstream cache even with identical prompt', async () => {
  const h = new DurableHarness(':memory:'), f = fixture(), p = plan(); p.nodes[0].cache = false;
  await drain(h, h.enqueue(p, 'a'), f.adapter);
  const run = h.enqueue(p, 'b'); assert.equal(h.jobs(run).find(j => j.node_id === 'edit')!.state, 'queued'); h.close();
});
test('cache never crosses project ownership', async () => {
  const h = new DurableHarness(':memory:'), f = fixture(); await drain(h, h.enqueue(plan(), 'a'), f.adapter);
  const p = plan(); p.projectId = 'other'; const run = h.enqueue(p, 'a');
  assert.ok(h.jobs(run).every(j => j.state === 'queued')); h.close();
});
test('dependencies wait and receive accepted outputs', async () => {
  const h = new DurableHarness(':memory:'), f = fixture(); let sawDependencies = false;
  const adapter = { ...f.adapter, async submit(input: Parameters<Adapter['submit']>[0], ctx: Parameters<Adapter['submit']>[1]) {
    if (Object.keys(ctx.dependencies).length) { sawDependencies = true; assert.deepEqual(Object.keys(ctx.dependencies).sort(), ['shot-a', 'shot-b']); }
    return f.adapter.submit(input, ctx);
  } };
  await drain(h, h.enqueue(plan(), 'a'), adapter); assert.ok(sawDependencies); h.close();
});
test('ambiguous Router submission reuses the persisted key instead of creating a second paid request', async () => {
  let time = 1000, attempts = 0; const keys: string[] = [];
  const h = new DurableHarness(':memory:', () => time), f = fixture();
  const adapter = { ...f.adapter, async submit(_input: Parameters<Adapter['submit']>[0], ctx: Parameters<Adapter['submit']>[1]) { keys.push(ctx.key); if (++attempts === 1) throw new Error('lost response'); return { id: 'remote-1' }; } };
  const p = plan(); p.nodes = [p.nodes[0]]; const run = h.enqueue(p, 'a');
  await h.step(run, { fixture: adapter }); time += 3000; await h.step(run, { fixture: adapter });
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.equal(h.jobs(run)[0].provider_id, 'remote-1'); h.close();
});
test('manual-recovery providers stop after ambiguous submit and block dependent work', async () => {
  const h = new DurableHarness(':memory:'), f = fixture(); let submits = 0;
  const adapter: Adapter = { ...f.adapter, recovery: 'manual', async submit() { submits++; throw new Error('network lost'); } };
  const run = h.enqueue(plan(), 'a'); await drain(h, run, adapter);
  assert.equal(submits, 2); assert.deepEqual(h.jobs(run).map(j => j.state), ['uncertain', 'uncertain', 'blocked']);
  h.retry(run); await drain(h, run, adapter); assert.equal(submits, 2); h.close();
});
test('restart resumes polling an accepted remote job, without a second submit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-')), file = join(dir, 'state.db'), f = fixture();
  let h = new DurableHarness(file); const p = plan(); p.nodes = [p.nodes[0]]; const run = h.enqueue(p, 'a');
  await h.step(run, { fixture: f.adapter }); h.close(); h = new DurableHarness(file);
  await h.step(run, { fixture: f.adapter }); assert.equal(f.counts().calls, 1); assert.equal(h.jobs(run)[0].state, 'succeeded'); h.close(); rmSync(dir, { recursive: true });
});
test('canceling queued nodes never submits; canceling running nodes requires provider confirmation', async () => {
  const h = new DurableHarness(':memory:'), f = fixture(), p = plan(); p.nodes = [p.nodes[0]];
  const a = h.enqueue(p, 'a'); h.cancel(a); await drain(h, a, f.adapter); assert.equal(f.counts().calls, 0);
  const b = h.enqueue(p, 'b'); await h.step(b, { fixture: f.adapter }); h.cancel(b);
  await h.step(b, { fixture: { ...f.adapter, async poll() { return { state: 'canceled' }; } } });
  assert.equal(f.counts().cancellations, 1); assert.equal(h.jobs(b)[0].state, 'canceled'); h.close();
});
test('a late successful provider result after cancel stays auditable but cannot seed cache', async () => {
  const h = new DurableHarness(':memory:'), f = fixture(), p = plan(); p.nodes = [p.nodes[0]];
  const a = h.enqueue(p, 'a'); await h.step(a, { fixture: f.adapter }); h.cancel(a); await h.step(a, { fixture: f.adapter });
  assert.equal(h.jobs(a)[0].state, 'succeeded'); assert.equal(h.jobs(a)[0].cancel_requested, 1);
  assert.equal(h.jobs(h.enqueue(p, 'b'))[0].state, 'queued'); h.close();
});
test('concurrent workers cannot claim an active lease; expired workers cannot overwrite a newer result', async () => {
  let time = 1000; const h = new DurableHarness(':memory:', () => time), f = fixture(), p = plan(); p.nodes = [p.nodes[0]];
  const run = h.enqueue(p, 'a'); let finish!: (v: { id: string }) => void;
  const first = h.step(run, { fixture: { ...f.adapter, submit: async () => new Promise(r => { finish = r; }) } });
  assert.equal(await h.step(run, { fixture: f.adapter }), false);
  time += 121000; await h.step(run, { fixture: f.adapter }); const currentId = h.jobs(run)[0].provider_id;
  finish({ id: 'stale-job' }); await first; assert.equal(h.jobs(run)[0].provider_id, currentId); h.close();
});
test('definitive provider rejection does not become an automatic paid retry', async () => {
  const h = new DurableHarness(':memory:'), f = fixture(); let calls = 0;
  const adapter = { ...f.adapter, async submit() { calls++; throw new RejectedSubmission('out of credits'); } };
  const p = plan(); p.nodes = [p.nodes[0]]; const run = h.enqueue(p, 'a'); await drain(h, run, adapter);
  assert.equal(calls, 1); assert.equal(h.jobs(run)[0].state, 'failed'); h.close();
});
test('exhausted replay recovery remains uncertain, never retryable as a definitive failure', async () => {
  let time = 1000, submits = 0; const h = new DurableHarness(':memory:', () => time), f = fixture();
  const p = plan(); p.nodes = [p.nodes[0]]; const run = h.enqueue(p, 'a');
  const adapter = { ...f.adapter, async submit() { submits++; throw new Error('lost response'); } };
  for (let i = 0; i < 4; i++) { await h.step(run, { fixture: adapter }); time += 3000; }
  assert.equal(h.jobs(run)[0].state, 'uncertain'); assert.equal(submits, 3);
  h.retry(run); await h.step(run, { fixture: adapter }); assert.equal(submits, 3); h.close();
});
test('a lost cancel response still polls the actual remote outcome', async () => {
  const h = new DurableHarness(':memory:'), f = fixture(), p = plan(); p.nodes = [p.nodes[0]];
  const run = h.enqueue(p, 'a'); await h.step(run, { fixture: f.adapter }); h.cancel(run);
  await h.step(run, { fixture: { ...f.adapter, async cancel() { throw new Error('lost cancel response'); }, async poll() { return { state: 'canceled' }; } } });
  assert.equal(h.jobs(run)[0].state, 'canceled'); assert.ok(h.events(run).some(e => e.event === 'cancel_response_unconfirmed')); h.close();
});
