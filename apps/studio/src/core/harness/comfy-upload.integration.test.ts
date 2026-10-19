import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableHarness, type Plan } from './durable';
import { createComfyUploadAdapter, pinProjectInputs, readProjectInputImage } from './comfy-upload';
import { createComfyWorkflowAdapter, connectionHash } from './comfy-workflow';

const dir = await mkdtemp(join(tmpdir(), 'vh-input-image-'));
process.env.VIRAL_HIT_DATA_DIR = dir;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(dir, { recursive: true, force: true }); });
const { createProject } = await import('../projects/projects');
const { persistLocalProjectAsset, LOCAL_PROJECT_ASSET_BUCKET, LOCAL_PROJECT_ASSET_PROVIDER } = await import('../projects/local-project-assets');
const { recordUserAsset, linkProjectAsset } = await import('../workspace-lib/assets/user-assets');
const png = await readFile('public/logo.png');
async function fixtureAsset() {
  const project = await createProject({ name: 'Image input test' });
  const saved = await persistLocalProjectAsset({ projectId: project.id, filename: 'source.png', mimeType: 'image/png', bytes: png });
  await recordUserAsset({ id: saved.assetId, type: 'image', source: 'upload', bucket: LOCAL_PROJECT_ASSET_BUCKET, storageProvider: LOCAL_PROJECT_ASSET_PROVIDER, objectKey: saved.objectKey, publicUrl: saved.publicUrl, sha256: saved.sha256, sizeBytes: saved.sizeBytes, filename: 'source.png', mimeType: 'image/png' });
  await linkProjectAsset({ projectId: project.id, assetId: saved.assetId, role: 'upload' });
  const plan: Plan = { projectId: project.id, nodes: [{ id: 'input', operation: 'comfy.upload', version: '1', cache: false, input: { assetId: saved.assetId } }] };
  return { project, saved, plan };
}
async function uploadServer() {
  const state = { posts: 0, drop: false, rename: false, redirect: false, files: new Map<string, Buffer>(), paths: [] as string[] };
  const http = createServer(async (req, res) => {
    state.paths.push(req.url!);
    if (req.url !== '/upload/image') { res.writeHead(404); res.end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    const form = await new Request('http://fixture/upload/image', { method: 'POST', headers: { 'content-type': req.headers['content-type']! }, body: Buffer.concat(chunks) }).formData();
    const image = form.get('image') as File, bytes = Buffer.from(await image.arrayBuffer()), subfolder = String(form.get('subfolder'));
    assert.equal(form.get('overwrite'), 'false'); assert.equal(form.get('type'), 'input');
    assert.equal(image.name, `${createHash('sha256').update(bytes).digest('hex')}.png`);
    state.posts++; state.files.set(`${subfolder}/${image.name}`, bytes);
    if (state.drop) { state.drop = false; res.destroy(); return; }
    if (state.redirect) { res.writeHead(302, { Location: '/external' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ name: state.rename ? 'renamed.png' : image.name, subfolder, type: 'input' }));
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  return { state, url: new URL(`http://127.0.0.1:${(http.address() as any).port}/`), close: () => new Promise<void>(resolve => { http.closeAllConnections(); http.close(() => resolve()); }) };
}
test('project input pinning rejects cross-project images, altered bytes and requested hash mismatch', async () => {
  const a = await fixtureAsset(), other = await createProject({ name: 'Other project' }), url = new URL('http://localhost:8188/');
  const pinned = await pinProjectInputs(a.plan, () => url);
  assert.equal((pinned.nodes[0].input as any).sha256, a.saved.sha256);
  assert.equal((a.plan.nodes[0].input as any).sha256, undefined);
  await assert.rejects(pinProjectInputs({ ...a.plan, projectId: other.id }, () => url), /belonging/);
  const bad = structuredClone(a.plan); (bad.nodes[0].input as any).sha256 = '0'.repeat(64);
  await assert.rejects(pinProjectInputs(bad, () => url), /changed/);
  await writeFile(a.saved.filePath, Buffer.from('changed'));
  await assert.rejects(readProjectInputImage(a.project.id, a.saved.assetId), /integrity/);
});
test('upload sends actual project bytes and returns a connection-bound filename receipt', async () => {
  const f = await uploadServer(), a = await fixtureAsset(), h = new DurableHarness(':memory:');
  try {
    const plan = await pinProjectInputs(a.plan, () => f.url), run = h.enqueue(plan, 'input');
    const adapters = { 'comfy.upload': createComfyUploadAdapter(() => f.url) };
    await h.step(run, adapters); await h.step(run, adapters);
    const job = h.jobs(run)[0]; assert.equal(job.state, 'succeeded');
    const receipt = JSON.parse(job.output_json!); assert.equal(receipt.connection, connectionHash(f.url)); assert.equal(receipt.sha256, a.saved.sha256);
    assert.deepEqual(f.state.files.get(receipt.image), png); assert.equal(f.state.posts, 1);
  } finally { h.close(); await f.close(); }
});
test('lost upload response replays identical content-addressed bytes across worker restart without generation', async () => {
  const f = await uploadServer(), a = await fixtureAsset(); f.state.drop = true;
  let now = 10000;
  const ledger = join(dir, randomUUID()+'.db'); let h = new DurableHarness(ledger, () => now);
  try {
    const run = h.enqueue(await pinProjectInputs(a.plan, () => f.url), 'lost'), adapters = { 'comfy.upload': createComfyUploadAdapter(() => f.url) };
    await h.step(run, adapters); assert.equal(h.jobs(run)[0].state, 'submitting');
    h.close(); h = new DurableHarness(ledger, () => now); now += 3000;
    await h.step(run, adapters); await h.step(run, adapters);
    assert.equal(h.jobs(run)[0].state, 'succeeded'); assert.equal(f.state.posts, 2); assert.equal(f.state.files.size, 1);
    assert.ok(f.state.paths.every(path => path === '/upload/image'));
  } finally { h.close(); await f.close(); }
});
test('changed source, server mismatch and unpinned uploads fail before sending bytes', async () => {
  const f = await uploadServer(), a = await fixtureAsset();
  try {
    const input = (await pinProjectInputs(a.plan, () => f.url)).nodes[0].input;
    const context = { key: randomUUID(), dependencies: {}, signal: AbortSignal.timeout(5000), projectId: a.project.id };
    await assert.rejects(createComfyUploadAdapter(() => f.url).submit(a.plan.nodes[0].input, context), /pinned/);
    await assert.rejects(createComfyUploadAdapter(() => new URL('http://localhost:9999/')).submit(input, context), /connection/);
    const workflow = { workflow: { '1': { class_type: 'SaveImage', inputs: {} } }, output: { nodeId: '1', field: 'images', index: 0 }, connection: connectionHash(new URL('http://localhost:9999/')) };
    await assert.rejects(createComfyWorkflowAdapter(() => f.url).submit(workflow, context), /different/);
    await writeFile(a.saved.filePath, 'altered after queue');
    await assert.rejects(createComfyUploadAdapter(() => f.url).submit(input, context), /integrity/);
    assert.equal(f.state.posts, 0);
  } finally { await f.close(); }
});
test('renamed output and upload redirects cannot become successful input receipts', async () => {
  const f = await uploadServer(), a = await fixtureAsset();
  try {
    const input = (await pinProjectInputs(a.plan, () => f.url)).nodes[0].input;
    const context = { key: randomUUID(), dependencies: {}, signal: AbortSignal.timeout(5000), projectId: a.project.id };
    f.state.rename = true;
    await assert.rejects(createComfyUploadAdapter(() => f.url).submit(input, context), /filename/);
    f.state.rename = false; f.state.redirect = true;
    await assert.rejects(createComfyUploadAdapter(() => f.url).submit(input, context));
    assert.equal(f.state.paths.includes('/external'), false);
  } finally { await f.close(); }
});
