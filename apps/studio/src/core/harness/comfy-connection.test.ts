import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readComfyConnection, saveComfyConnection, normalizeComfyUrl, checkComfyConnection } from './comfy-connection';
import { comfyWorkflowUrl, connectionHash, createComfyWorkflowAdapter } from './comfy-workflow';
import { pinProjectInputs } from './comfy-upload';
import { DurableHarness, type Plan } from './durable';

async function isolated(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'vh-connection-'));
  const previous = { data: process.env.VIRAL_HIT_DATA_DIR, url: process.env.VIRAL_HIT_COMFYUI_URL };
  process.env.VIRAL_HIT_DATA_DIR = root; delete process.env.VIRAL_HIT_COMFYUI_URL;
  try { await run(root); } finally {
    for (const [key, value] of [['VIRAL_HIT_DATA_DIR', previous.data], ['VIRAL_HIT_COMFYUI_URL', previous.url]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
    rmSync(root, { recursive: true, force: true });
  }
}

test('workspace connection persists across processes, compares revisions and disconnects without touching media', async () => isolated(async root => {
  assert.equal(readComfyConnection().source, 'none'); assert.equal(existsSync(join(root, 'connections.sqlite')), false);
  const saved = saveComfyConnection('http://127.0.0.1:8188/comfy', 0);
  assert.equal(saved.url, 'http://127.0.0.1:8188/comfy/'); assert.equal(saved.revision, 1);
  assert.equal(saveComfyConnection(saved.url, 1).revision, 1);
  assert.throws(() => saveComfyConnection('http://localhost:8888', 0), /changed/);
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import {readComfyConnection} from ${JSON.stringify(new URL('./comfy-connection.ts', import.meta.url).href)}; console.log(JSON.stringify(readComfyConnection()));`], { env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), saved);
  const disconnected = saveComfyConnection(null, 1); assert.equal(disconnected.revision, 2); assert.equal(comfyWorkflowUrl(), null);
  assert.equal(existsSync(join(root, 'harness.db')), false);
}));

test('environment override remains read-only, invalid overrides cannot fall through and database symlinks are refused', async () => isolated(async root => {
  saveComfyConnection('http://localhost:8188', 0);
  process.env.VIRAL_HIT_COMFYUI_URL = 'http://localhost:9000/';
  assert.equal(readComfyConnection().source, 'environment'); assert.equal(readComfyConnection().editable, false);
  assert.equal(comfyWorkflowUrl()?.port, '9000'); assert.throws(() => saveComfyConnection(null, 1), /managed/);
  process.env.VIRAL_HIT_COMFYUI_URL = 'http://user:secret@localhost/';
  assert.equal(readComfyConnection().url, null); assert.ok(!JSON.stringify(readComfyConnection()).includes('secret')); assert.throws(() => comfyWorkflowUrl(), /invalid/);
  delete process.env.VIRAL_HIT_COMFYUI_URL; assert.equal(comfyWorkflowUrl()?.port, '8188');
  rmSync(join(root, 'connections.sqlite')); symlinkSync(join(root, 'missing'), join(root, 'connections.sqlite'));
  assert.throws(() => readComfyConnection(), /regular/); assert.throws(() => saveComfyConnection(null, 1), /regular/);
}));

test('two concurrent writers cannot silently replace a connection from the same revision', async () => isolated(async () => {
  const child = (port: number) => new Promise<number | null>((resolve, reject) => {
    const code = `import {saveComfyConnection} from ${JSON.stringify(new URL('./comfy-connection.ts', import.meta.url).href)}; try {saveComfyConnection('http://localhost:${port}',0);} catch {process.exit(7);}`;
    const processHandle = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { env: process.env, stdio: 'pipe' });
    processHandle.on('error', reject); processHandle.on('exit', resolve);
  });
  assert.deepEqual((await Promise.all([child(8188), child(9000)])).sort(), [0, 7]);
  assert.equal(readComfyConnection().revision, 1);
}));

test('connection checks are bounded GET-only requests and never save settings', async () => isolated(async () => {
  for (const value of ['file:///tmp/a', 'ftp://localhost', 'http://user:secret@localhost', 'http://localhost/?token=secret', 'http://localhost/#x', 'not-url']) assert.throws(() => normalizeComfyUrl(value));
  let mode = 'ok'; const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(`${req.method} ${req.url}`);
    if (mode === 'redirect') { res.writeHead(302, { location: '/must-not-follow' }); res.end(); }
    else if (mode === 'large') { res.writeHead(200, { 'content-length': 65000 }); res.end('x'.repeat(65000)); }
    else if (mode === 'stream') { res.writeHead(200); res.write('x'.repeat(65000)); res.end(); }
    else if (mode === 'invalid') res.end(JSON.stringify({ something: true }));
    else if (mode === 'slow') { /* caller deadline closes this request */ }
    else res.end(JSON.stringify({ system: { comfyui_version: 'fixture' }, devices: [{ type: 'cpu' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/prefix/`;
  try {
    const check = await checkComfyConnection(url); assert.equal(check.version, 'fixture'); assert.deepEqual(check.devices, ['cpu']);
    for (const value of ['redirect', 'large', 'stream', 'invalid', 'slow']) { mode = value; await assert.rejects(checkComfyConnection(url, AbortSignal.timeout(100))); }
    assert.deepEqual(new Set(paths), new Set(['GET /prefix/system_stats'])); assert.equal(readComfyConnection().source, 'none');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}));

test('native jobs pin the enqueue connection and refuse submission or reconciliation on another server', async () => isolated(async () => {
  const a = new URL('http://127.0.0.1:8188/'), b = new URL('http://127.0.0.1:8189/');
  const plan: Plan = { projectId: 'fixture', nodes: [{ id: 'native', operation: 'comfy.workflow', version: '1', input: { workflow: { '1': { class_type: 'EmptyImage', inputs: {} } }, output: { nodeId: '1', field: 'images', index: 0 } } }] };
  const pinned = await pinProjectInputs(plan, () => a);
  assert.equal((pinned.nodes[0].input as any).connection, connectionHash(a)); assert.equal((plan.nodes[0].input as any).connection, undefined);
  await assert.rejects(pinProjectInputs(pinned, () => b), /changed/);
  await assert.rejects(pinProjectInputs(plan, () => null), /Connect/);
  const invalid = structuredClone(plan); invalid.nodes[0].bindings = [{ target: '/connection', node: 'other', pointer: '/connection' }];
  await assert.rejects(pinProjectInputs(invalid, () => a), /pinned image/);
  const h = new DurableHarness(':memory:');
  try {
    const old = h.enqueue(plan, 'legacy'); await h.step(old, { 'comfy.workflow': createComfyWorkflowAdapter(() => a) });
    assert.equal(h.jobs(old)[0].state, 'failed'); assert.match(h.jobs(old)[0].error!, /not pinned/);
    const run = h.enqueue(pinned, 'pinned'); await h.step(run, { 'comfy.workflow': createComfyWorkflowAdapter(() => b) });
    assert.equal(h.jobs(run)[0].state, 'failed'); assert.match(h.jobs(run)[0].error!, /different ComfyUI/);
    const adapter = createComfyWorkflowAdapter(() => b);
    await assert.rejects(adapter.reconcile!(pinned.nodes[0].input, { key: 'fixture', signal: AbortSignal.timeout(100) } as any), /restore the original/);
  } finally { h.close(); }
}));
