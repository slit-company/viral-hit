import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableHarness, fingerprint } from './durable';
import { createComfyWorkflowAdapter, comfyWorkflowUrl, workflowInput } from './comfy-workflow';
import { pinProjectInputs } from './comfy-upload';
import { compileRecipe } from './recipes';

const directory = await mkdtemp(join(tmpdir(), 'vh-comfy-workflow-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { createProject } = await import('../projects/projects');
const { createMaterializeAdapter } = await import('./materialize');
const { attachMaterializedJob } = await import('./attach-asset');
const recipe = JSON.parse(await readFile('../../recipes/local-canvas.json', 'utf8'));
const image = await readFile('public/logo.png');

async function server() {
  const state = { posts: 0, views: 0, paths: [] as string[], drop: false, accept: true, reject: false, pending: false, history: {} as Record<string, any>, queue: [] as unknown[][], last: null as any, unsafeOutput: false, redirect: false };
  function publish(body: any) {
    const prompt = [1, body.prompt_id, body.prompt, body.extra_data, ['2']];
    if (state.pending) state.queue = [prompt];
    else state.history[body.prompt_id] = { prompt, status: { completed: true, status_str: 'success', messages: [] }, outputs: { '2': { images: [{ filename: state.unsafeOutput ? '../private.png' : 'fixture.png', subfolder: '', type: 'output' }] } } };
  }
  const http = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, 'http://localhost'); state.paths.push(url.pathname);
      let data = ''; for await (const chunk of req) data += chunk;
      const send = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (url.pathname === '/prompt') {
        state.posts++; const body = JSON.parse(data); state.last = body;
        if (state.reject) { send({ error: 'Invalid node' }, 400); return; }
        if (state.accept) publish(body);
        if (state.drop) { res.destroy(); return; }
        send({ prompt_id: body.prompt_id });
      } else if (url.pathname.startsWith('/history/')) { const id = url.pathname.split('/').pop()!; send(state.history[id] ? { [id]: state.history[id] } : {}); }
      else if (url.pathname === '/history') send(state.history);
      else if (url.pathname === '/queue') send({ queue_running: [], queue_pending: state.queue });
      else if (url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/cancel')) {
        const id = url.pathname.split('/')[3], found = state.queue.some(item => item[1] === id);
        state.queue = state.queue.filter(item => item[1] !== id); send({ cancelled: found });
      } else if (url.pathname === '/view') {
        state.views++;
        if (state.redirect) { res.writeHead(302, { Location: '/must-not-follow' }); res.end(); }
        else { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(image); }
      } else send({}, 404);
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as { port: number }).port;
  return { state, publish, url: new URL(`http://127.0.0.1:${port}/`), close: () => new Promise<void>((resolve, reject) => { http.closeAllConnections(); http.close(error => error ? reject(error) : resolve()); }) };
}

test('native ComfyUI workflow response, output download and timeline attachment use the shared contracts', async () => {
  const fixture = await server(), project = await createProject({ name: 'Native workflow protocol fixture' });
  const h = new DurableHarness(':memory:');
  try {
    const adapters = { 'comfy.workflow': createComfyWorkflowAdapter(() => fixture.url), 'asset.materialize': createMaterializeAdapter() };
    const run = h.enqueue(await pinProjectInputs(compileRecipe(recipe, { width: 512, height: 512, color: 1 }, project.id), () => fixture.url), 'workflow');
    for (let i = 0; i < 4; i++) await h.step(run, adapters);
    const jobs = h.jobs(run); assert.deepEqual(jobs.map(job => job.state), ['succeeded', 'succeeded']);
    assert.equal(fixture.state.posts, 1); assert.equal(fixture.state.views, 1);
    assert.equal(JSON.parse(jobs[0].output_json!).provider, 'comfy-workflow');
    assert.equal((await attachMaterializedJob(h, project.id, run, jobs[1].id, 0)).ok, true);
    assert.equal(fixture.state.last.prompt['1'].inputs.color, 1);
  } finally { h.close(); await fixture.close(); }
});

test('lost submission response recovers from native history after restart without posting twice', async () => {
  const fixture = await server(), project = await createProject({ name: 'Lost native workflow response' }); fixture.state.drop = true;
  const file = join(directory, 'reconcile.db'); let now = 10000, h = new DurableHarness(file, () => now);
  const adapters = { 'comfy.workflow': createComfyWorkflowAdapter(() => fixture.url) };
  try {
    const plan = await pinProjectInputs(compileRecipe(recipe, {}, project.id), () => fixture.url); plan.nodes = [plan.nodes[0]];
    const run = h.enqueue(plan, 'lost'); await h.step(run, adapters);
    assert.equal(h.jobs(run)[0].state, 'submitting'); h.close(); h = new DurableHarness(file, () => now); now += 3000;
    await h.step(run, adapters); assert.equal(h.jobs(run)[0].state, 'running');
    await h.step(run, adapters); assert.equal(h.jobs(run)[0].state, 'succeeded'); assert.equal(fixture.state.posts, 1);
  } finally { h.close(); await fixture.close(); }
});

test('unobserved submission stays uncertain and explicit reconciliation only searches, including ownership checks', async () => {
  const fixture = await server(), project = await createProject({ name: 'Unknown workflow fixture' }); fixture.state.drop = true; fixture.state.accept = false;
  let now = 10000; const h = new DurableHarness(':memory:', () => now), adapters = { 'comfy.workflow': createComfyWorkflowAdapter(() => fixture.url) };
  try {
    const plan = await pinProjectInputs(compileRecipe(recipe, {}, project.id), () => fixture.url); plan.nodes = [plan.nodes[0]];
    const run = h.enqueue(plan, 'unknown'); await h.step(run, adapters); now += 3000; await h.step(run, adapters);
    assert.equal(h.jobs(run)[0].state, 'uncertain'); h.retry(run); assert.equal(h.jobs(run)[0].state, 'uncertain');
    fixture.publish({ ...fixture.state.last, extra_data: { viral_hit: { key: 'different', fingerprint: fingerprint(plan.nodes[0].input) } } });
    h.requestReconciliation(run, ['comfy.workflow']); await h.step(run, adapters); assert.equal(h.jobs(run)[0].state, 'uncertain');
    fixture.publish(fixture.state.last); h.requestReconciliation(run, ['comfy.workflow']); await h.step(run, adapters);
    assert.equal(h.jobs(run)[0].state, 'running'); assert.equal(fixture.state.posts, 1);
  } finally { h.close(); await fixture.close(); }
});

test('targeted cancellation removes only this queued workflow and never calls the global interrupt endpoint', async () => {
  const fixture = await server(), project = await createProject({ name: 'Targeted cancellation fixture' }); fixture.state.pending = true;
  const h = new DurableHarness(':memory:'), adapters = { 'comfy.workflow': createComfyWorkflowAdapter(() => fixture.url) };
  try {
    const plan = await pinProjectInputs(compileRecipe(recipe, {}, project.id), () => fixture.url); plan.nodes = [plan.nodes[0]];
    const run = h.enqueue(plan, 'cancel'); await h.step(run, adapters);
    const other = [2, randomUUID(), {}, {}, []]; fixture.state.queue.push(other);
    h.cancel(run); await h.step(run, adapters); assert.equal(h.jobs(run)[0].state, 'canceled');
    assert.deepEqual(fixture.state.queue, [other]); assert.equal(fixture.state.paths.includes('/interrupt'), false);
  } finally { h.close(); await fixture.close(); }
});

test('native workflow transport rejects server redirects and unsafe output paths, and fences connection changes', async () => {
  const fixture = await server(), project = await createProject({ name: 'Native workflow source validation' });
  let base = fixture.url; const adapter = createComfyWorkflowAdapter(() => base), input = (await pinProjectInputs(compileRecipe(recipe, {}, project.id), () => fixture.url)).nodes[0].input;
  const context = { key: randomUUID(), dependencies: {}, signal: AbortSignal.timeout(10000), projectId: project.id, runId: randomUUID(), jobId: randomUUID() };
  try {
    fixture.state.unsafeOutput = true; const { id } = await adapter.submit(input, context);
    assert.equal((await adapter.poll(id, input, context.signal, context)).state, 'failed'); assert.equal(fixture.state.views, 0);
    fixture.state.unsafeOutput = false; fixture.publish(fixture.state.last); fixture.state.redirect = true;
    await assert.rejects(adapter.poll(id, input, context.signal, context)); assert.equal(fixture.state.paths.includes('/must-not-follow'), false);
    base = new URL('http://127.0.0.1:1/'); await assert.rejects(adapter.poll(id, input, context.signal, context), /connection changed/);
    for (const bad of ['file:///tmp/comfy', 'https://user:pass@example.org', 'http://localhost/?x=1']) assert.throws(() => comfyWorkflowUrl(bad));
    assert.equal(workflowInput.safeParse({ ...(input as object), url: 'http://attacker' }).success, false);
  } finally { await fixture.close(); }
});

test('known workflow validation failure is definitive and never enters ambiguous recovery', async () => {
  const fixture = await server(), project = await createProject({ name: 'Invalid workflow fixture' }); fixture.state.reject = true;
  const h = new DurableHarness(':memory:');
  try {
    const plan = await pinProjectInputs(compileRecipe(recipe, {}, project.id), () => fixture.url); plan.nodes = [plan.nodes[0]];
    const run = h.enqueue(plan, 'rejected'); await h.step(run, { 'comfy.workflow': createComfyWorkflowAdapter(() => fixture.url) });
    assert.equal(h.jobs(run)[0].state, 'failed'); assert.equal(fixture.state.posts, 1);
  } finally { h.close(); await fixture.close(); }
});

test('confirmed workflow with cleared history resumes observation and its blocked descendants without regeneration', async () => {
  const fixture = await server(), project = await createProject({ name: 'Lost provider history fixture' });
  const h = new DurableHarness(':memory:'), adapters = { 'comfy.workflow': createComfyWorkflowAdapter(() => fixture.url), 'asset.materialize': createMaterializeAdapter() };
  try {
    const plan = await pinProjectInputs(compileRecipe(recipe, {}, project.id), () => fixture.url);
    const run = h.enqueue(plan, 'history-lost'); await h.step(run, adapters); fixture.state.history = {};
    await h.step(run, adapters); assert.equal(h.jobs(run)[0].state, 'uncertain'); assert.ok(h.jobs(run)[0].provider_id);
    await h.step(run, adapters); assert.equal(h.jobs(run)[1].state, 'blocked');
    fixture.publish(fixture.state.last); h.requestReconciliation(run, ['comfy.workflow']);
    for (let i = 0; i < 3; i++) await h.step(run, adapters);
    assert.deepEqual(h.jobs(run).map(job => job.state), ['succeeded', 'succeeded']); assert.equal(fixture.state.posts, 1);
  } finally { h.close(); await fixture.close(); }
});


test('switching servers during a lost submission keeps recovery uncertain and cannot make retry resubmit', async () => {
  const fixture = await server(), other = await server(), project = await createProject({ name: 'Connection recovery fence' });
  fixture.state.drop = true; let base = fixture.url, now = 10000;
  const h = new DurableHarness(':memory:', () => now), adapters = { 'comfy.workflow': createComfyWorkflowAdapter(() => base) };
  try {
    const plan = await pinProjectInputs(compileRecipe(recipe, {}, project.id), () => base); plan.nodes = [plan.nodes[0]];
    const run = h.enqueue(plan, 'switch-lost'); await h.step(run, adapters);
    assert.equal(fixture.state.posts, 1); assert.equal(h.jobs(run)[0].state, 'submitting');
    base = other.url; now += 3000; await h.step(run, adapters);
    assert.equal(h.jobs(run)[0].state, 'uncertain'); assert.equal(other.state.paths.length, 0);
    h.retry(run); assert.equal(h.jobs(run)[0].state, 'uncertain');
    base = fixture.url; h.requestReconciliation(run, ['comfy.workflow']); await h.step(run, adapters);
    assert.equal(h.jobs(run)[0].state, 'running'); await h.step(run, adapters);
    assert.equal(h.jobs(run)[0].state, 'succeeded'); assert.equal(fixture.state.posts, 1); assert.equal(other.state.posts, 0);
  } finally { h.close(); await fixture.close(); await other.close(); }
});
