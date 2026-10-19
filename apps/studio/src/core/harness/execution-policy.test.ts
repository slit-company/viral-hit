import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableHarness, type Adapter } from './durable';
import { executionTimeout } from './execution-policy';
import { externalDescriptor } from './external-catalog';

test('execution budgets are bounded and independent of recipe input', () => {
  assert.equal(executionTimeout(), 60000);
  assert.equal(executionTimeout({ timeoutMs: 240000, abortOnCancel: true }), 240000);
  for (const timeoutMs of [0, -1, Infinity, 300001]) assert.throws(() => executionTimeout({ timeoutMs, abortOnCancel: false }));
  const descriptor = { schemaVersion: 1, operation: 'ext.long-local', version: '1', label: 'Local renderer', author: 'Fixture', license: 'Apache-2.0',
    entry: 'local.mjs', sha256: '0'.repeat(64), recovery: 'replay', generation: false, inputSchema: { type: 'object' },
    execution: { timeoutMs: 240000, abortOnCancel: true } };
  assert.equal(externalDescriptor.parse(descriptor).execution?.timeoutMs, 240000);
  assert.throws(() => externalDescriptor.parse({ ...descriptor, execution: { timeoutMs: 999999, abortOnCancel: true } }));
});
test('long execution retains exclusion beyond the old lease and stale completion cannot replace a new owner', async () => {
  let time = 1000;
  const h = new DurableHarness(':memory:', () => time);
  const run = h.enqueue({ projectId: 'p', nodes: [{ id: 'local', operation: 'local', version: '1', input: {} }] }, 'long');
  let finish!: (result: { id: string }) => void;
  const adapter: Adapter = { recovery: 'replay', execution: { timeoutMs: 240000, abortOnCancel: true },
    submit: async () => new Promise(resolve => { finish = resolve; }), poll: async () => ({ state: 'succeeded' }) };
  try {
    const first = h.step(run, { local: adapter });
    assert.equal(h.jobs(run)[0].lease_until, 301000);
    time += 121000; assert.equal(await h.step(run, { local: adapter }), false);
    time += 180000;
    await h.step(run, { local: { ...adapter, submit: async () => ({ id: 'new-owner' }) } });
    finish({ id: 'stale-owner' }); await first;
    assert.equal(h.jobs(run)[0].provider_id, 'new-owner');
  } finally { h.close(); }
});
test('local cancellation keeps the lease until child work settles and prevents descendants', async () => {
  const h = new DurableHarness(':memory:');
  const run = h.enqueue({ projectId: 'p', nodes: [
    { id: 'local', operation: 'local', version: '1', input: {} },
    { id: 'next', operation: 'local', version: '1', input: {}, dependsOn: ['local'] },
  ] }, 'cancel');
  let stop!: () => void, stopping!: () => void;
  const observed = new Promise<void>(resolve => { stopping = resolve; });
  const adapter: Adapter = { recovery: 'replay', execution: { timeoutMs: 240000, abortOnCancel: true },
    submit: async (_input, context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener('abort', () => { stop = () => reject(new Error('stopped')); stopping(); }, { once: true });
    }), poll: async () => ({ state: 'succeeded' }) };
  try {
    const step = h.step(run, { local: adapter }); h.cancel(run);
    await observed;
    assert.ok(h.jobs(run)[0].lease_token);
    assert.equal(await h.step(run, { local: adapter }), false);
    stop(); await step;
    assert.equal(h.jobs(run)[0].state, 'canceled');
    assert.equal(h.jobs(run)[1].state, 'canceled');
  } finally { h.close(); }
});
test('remote adapters keep ambiguity semantics and expired unclaimed leases cannot be finalized', async () => {
  let time = 1000;
  const h = new DurableHarness(':memory:', () => time);
  const run = h.enqueue({ projectId: 'p', nodes: [{ id: 'remote', operation: 'remote', version: '1', input: {} }] }, 'remote');
  let finish!: () => void;
  const adapter: Adapter = { recovery: 'manual', submit: async () => new Promise((_resolve, reject) => { finish = () => reject(new Error('lost')); }), poll: async () => ({ state: 'running' }) };
  try {
    const first = h.step(run, { remote: adapter }); h.cancel(run); finish(); await first;
    assert.equal(h.jobs(run)[0].state, 'uncertain');
    const next = h.enqueue({ projectId: 'p', nodes: [{ id: 'remote', operation: 'remote', version: '1', input: {} }] }, 'expired');
    const expired = h.step(next, { remote: adapter }); time += 121000; finish(); await expired;
    assert.equal(h.jobs(next)[0].state, 'submitting');
  } finally { h.close(); }
});
test('a canceled interrupted local submission does not require remote reconciliation or execute again', async () => {
  const h = new DurableHarness(':memory:');
  const run = h.enqueue({ projectId: 'p', nodes: [{ id: 'local', operation: 'local', version: '1', input: {} }] }, 'interrupted-local');
  h.db.prepare("UPDATE vh_jobs SET state='submitting',attempts=1 WHERE run_id=?").run(run);
  h.cancel(run);
  let invoked = false;
  const adapter: Adapter = { recovery: 'replay', execution: { timeoutMs: 240000, abortOnCancel: true },
    submit: async () => { invoked = true; return { id: 'should-not-execute' }; }, poll: async () => ({ state: 'succeeded' }) };
  try {
    await h.step(run, { local: adapter });
    assert.equal(invoked, false); assert.equal(h.jobs(run)[0].state, 'canceled');
  } finally { h.close(); }
});
