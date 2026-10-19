import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DurableHarness, type Plan } from './durable';
import { readExternalCatalog, pinExternalAdapters } from './external-catalog';
import { createExternalAdapter } from './external-adapters';
import { runtimeNodeSchema } from './requests';

const directory = await mkdtemp(join(tmpdir(), 'vh-external-tests-'));
after(async () => { await rm(directory, { recursive: true, force: true }); });
const source = await readFile('../../examples/adapters/tone/tone.mjs', 'utf8');
const original = JSON.parse(await readFile('../../examples/adapters/tone/tone.json', 'utf8'));
async function catalog(code = source, patch: Record<string, unknown> = {}) {
  const path = await mkdtemp(join(directory, 'adapter-'));
  const descriptor = { ...original, ...patch, sha256: createHash('sha256').update(code).digest('hex') };
  await writeFile(join(path, 'tone.mjs'), code); await writeFile(join(path, 'tone.json'), JSON.stringify(descriptor));
  return { path, entry: readExternalCatalog(path)[0] };
}
const plan = (): Plan => ({ projectId: 'sample', nodes: [{ id: 'tone', operation: 'ext.example-tone', version: '1', input: { frequency: 440, duration: 2 }, cache: false }] });

test('catalogue validates data without executing modules; uninstalled and reserved operations stay rejected', async () => {
  const marker = `VH_EXTERNAL_MARKER_${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const c = await catalog(`process.env.${marker} = 'executed';\n${source}`);
  assert.equal(process.env[marker], undefined);
  assert.throws(() => pinExternalAdapters(plan(), []), /unavailable/);
  assert.equal(runtimeNodeSchema.safeParse({ ...plan().nodes[0], operation: 'uninstalled.provider' }).success, false);
  assert.throws(() => readExternalCatalog('relative/path'), /absolute/);
  await writeFile(join(c.path, 'tone.mjs'), source + '// changed');
  assert.throws(() => readExternalCatalog(c.path), /SHA-256 mismatch/);
  await assert.rejects(catalog(source, { operation: 'comfy.router' }));
  await assert.rejects(catalog(source, { entry: '../tone.mjs' }));
  await assert.rejects(catalog(source, { inputSchema: { $async: true, type: 'object' } }), /synchronous/);
});

test('pinned adapter schema rejects malformed input and binds dependencies only within payload', async () => {
  const { entry } = await catalog();
  const bad = plan(); bad.nodes[0].input = { frequency: '440', duration: 2 };
  assert.throws(() => pinExternalAdapters(bad, [entry]), /Invalid.*input/);
  const wrong = plan(); wrong.nodes[0].version = '2'; assert.throws(() => pinExternalAdapters(wrong, [entry]), /version mismatch/);
  const bound = plan(); bound.nodes.unshift({ id: 'source', operation: 'fixture', version: '1', input: null });
  bound.nodes[1].input = { frequency: null, duration: 2 }; bound.nodes[1].dependsOn = ['source'];
  bound.nodes[1].bindings = [{ target: '/frequency', node: 'source', pointer: '/frequency' }];
  const pinned = pinExternalAdapters(bound, [entry]);
  assert.equal(pinned.nodes[1].bindings![0].target, '/payload/frequency');
  const h = new DurableHarness(':memory:');
  try {
    const run = h.enqueue(pinned, 'binding');
    const adapters = { fixture: { recovery: 'replay' as const, submit: async () => ({ id: 'source' }), poll: async () => ({ state: 'succeeded' as const, output: { frequency: 500 } }) }, 'ext.example-tone': createExternalAdapter(entry) };
    for (let i = 0; i < 3; i++) await h.step(run, adapters);
    const job = h.jobs(run)[1]; assert.equal(job.state, 'running');
    assert.equal(JSON.parse(job.execution_input_json!).payload.frequency, 500);
    assert.equal(JSON.parse(job.execution_input_json!).adapter.digest, entry.digest);
  } finally { h.close(); }
});

test('changed code or declared configuration never receives an old ambiguous submission', async () => {
  const marker = `VH_EXTERNAL_CALLS_${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const old = await catalog(`export default { recovery:'reconcile', async submit(){process.env.${marker}=String(Number(process.env.${marker}||0)+1);throw Error('lost response')}, async reconcile(){return null}, async poll(){return {state:'running'}} };`, { recovery: 'reconcile', configuration: [{ name: marker, required: false }] });
  // Configuration intentionally changes during the failed submit to exercise the fence.
  let now = 1_000; const h = new DurableHarness(':memory:', () => now);
  try {
    const run = h.enqueue(pinExternalAdapters(plan(), [old.entry]), 'ambiguous');
    await h.step(run, { 'ext.example-tone': createExternalAdapter(old.entry) });
    assert.equal(process.env[marker], '1'); assert.equal(h.jobs(run)[0].state, 'submitting');
    now += 5000;
    await h.step(run, { 'ext.example-tone': createExternalAdapter(old.entry) });
    assert.equal(h.jobs(run)[0].state, 'uncertain'); assert.equal(process.env[marker], '1');
    h.retry(run); assert.equal(h.jobs(run)[0].state, 'uncertain');
    const changed = await catalog(`throw Error('changed code must never load');`, { recovery: 'reconcile' });
    h.requestReconciliation(run, ['ext.example-tone']); now += 5000;
    await h.step(run, { 'ext.example-tone': createExternalAdapter(changed.entry) });
    assert.equal(h.jobs(run)[0].state, 'uncertain'); assert.match(h.jobs(run)[0].error!, /changed or was not pinned/);
    assert.equal(process.env[marker], '1');
  } finally { h.close(); delete process.env[marker]; }
});

test('worker executes captured verified bytes even if the original module file changes later', async () => {
  const c = await catalog(); const adapter = createExternalAdapter(c.entry);
  await writeFile(join(c.path, 'tone.mjs'), "throw Error('modified source ran');");
  const pinned = pinExternalAdapters(plan(), [c.entry]);
  assert.deepEqual(await adapter.submit(pinned.nodes[0].input, { key: 'stable', dependencies: {}, signal: AbortSignal.timeout(1000) }), { id: 'stable' });
});

test('media declarations reject unsafe pointers, overlapping IDs and aggregate over-allocation', async () => {
  const asset = { id: 'source', pointer: '/source', kind: 'audio', maxBytes: 32 * 1024 * 1024 };
  for (const inputs of [[asset, asset], [{ ...asset, pointer: '/constructor' }], [asset, { ...asset, id: 'second', pointer: '/source/child' }], [{ ...asset, maxBytes: 512 * 1024 * 1024 }, { ...asset, id: 'second', pointer: '/other', maxBytes: 1 }]]) {
    await assert.rejects(catalog(source, { assetInputs: inputs }));
  }
  const { entry } = await catalog(source, { assetInputs: [{ id: 'source', pointer: '/source', kind: 'audio' }] });
  assert.equal(entry.descriptor.assetInputs![0].maxBytes, 32 * 1024 * 1024);
});
