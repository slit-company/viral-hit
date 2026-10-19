import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, copyFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DurableHarness, type Plan, type Json } from './durable';
import { readExternalCatalog, pinExternalAdapters, externalEnvelope } from './external-catalog';
import { pinExternalMediaInputs } from './external-media-inputs';
import { readProjectMediaInput } from './project-media-input';
import { createExternalAdapter } from './external-adapters';
import { readBinaryReceipt } from './binary-receipts';
import { compileRecipe } from './recipes';

const directory = await mkdtemp(join(tmpdir(), 'vh-media-inputs-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
process.env.VIRAL_HIT_FFMPEG = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { createMaterializeAdapter } = await import('./materialize');
const { attachMaterializedJob } = await import('./attach-asset');
const gain = readExternalCatalog(resolve('../../examples/adapters/audio-gain'))[0];
const tone = readExternalCatalog(resolve('../../examples/adapters/tone'))[0];
const recipe = JSON.parse(await readFile('../../examples/adapter-recipes/audio-gain.json', 'utf8'));
const wav = join(directory, 'source.wav'), video = join(directory, 'source.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wav]);
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
const signal = () => AbortSignal.timeout(20_000);
const pin = (plan: Plan, entries = [gain]) => pinExternalMediaInputs(pinExternalAdapters(plan, entries), entries);
async function optionalEntry(optional = true) {
  const folder = await mkdtemp(join(directory, 'optional-'));
  const source = `export default { recovery:'replay', async submit(input, context) {
    if (input.sourceAssetId === null) {
      try { await context.readAsset('source'); throw Error('Unexpected readable empty slot'); }
      catch (error) { if (!error.message.includes('unpinned')) throw error; }
    } else await context.readAsset('source');
    return { id: context.key };
  }, async poll(){return {state:'running'}} };`;
  await writeFile(join(folder, 'audio-gain.mjs'), source);
  await writeFile(join(folder, 'audio-gain.json'), JSON.stringify({ ...gain.descriptor,
    sha256: createHash('sha256').update(source).digest('hex'),
    assetInputs: gain.descriptor.assetInputs!.map(item => ({ ...item, optional })),
    inputSchema: { type: 'object', required: ['sourceAssetId'], additionalProperties: false,
      properties: { sourceAssetId: { type: ['string', 'null'] } } },
  }));
  return readExternalCatalog(folder)[0];
}
async function sourceProject() {
  const project = await createProject({ name: 'Media processor' });
  const asset = await importLocalProjectAsset({ projectId: project.id, filePath: wav });
  return { project, asset };
}
async function fileFor(projectId: string, assetId: string) {
  const asset = await getProjectAssetById({ projectId, assetId }); assert.ok(asset);
  return resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
}

test('optional media pins explicit absence, never treating empty strings or missing fields as absent', async () => {
  const project = await createProject({ name: 'Optional media' }), entry = await optionalEntry();
  const raw: Plan = { projectId: project.id, nodes: [{ id: 'optional', operation: entry.descriptor.operation, version: '1', input: { sourceAssetId: null } }] };
  const plan = await pin(raw, [entry]);
  assert.equal(externalEnvelope.parse(plan.nodes[0].input).assetPins?.source, null);
  const adapter = createExternalAdapter(entry);
  const context = { key: 'optional', projectId: project.id, jobId: 'optional', dependencies: {}, signal: signal() };
  assert.deepEqual(await adapter.submit(plan.nodes[0].input, context), { id: 'optional' });
  for (const value of ['', 'missing-asset']) {
    const changed = structuredClone(raw); changed.nodes[0].input = { sourceAssetId: value };
    await assert.rejects(pin(changed, [entry]));
  }
  const missing = structuredClone(raw); missing.nodes[0].input = {};
  await assert.rejects(async () => pin(missing, [entry]));
  const required = await optionalEntry(false);
  await assert.rejects(pin(raw, [required]), /Select a project asset/);
  const tampered = structuredClone(plan.nodes[0].input) as { assetPins: Record<string, Json> };
  delete tampered.assetPins.source;
  await assert.rejects(adapter.submit(tampered, context), /unpinned/);
});

test('present optional media retains project ownership, content identity and replay fencing', async () => {
  const { project, asset } = await sourceProject(), entry = await optionalEntry();
  const raw: Plan = { projectId: project.id, nodes: [{ id: 'optional', operation: entry.descriptor.operation, version: '1', input: { sourceAssetId: asset.id } }] };
  const plan = await pin(raw, [entry]), input = plan.nodes[0].input;
  assert.equal(externalEnvelope.parse(input).assetPins?.source?.assetId, asset.id);
  const adapter = createExternalAdapter(entry);
  const context = { key: 'optional-present', projectId: project.id, jobId: 'optional-present', dependencies: {}, signal: signal() };
  assert.deepEqual(await adapter.submit(input, context), { id: 'optional-present' });
  const foreign = await createProject({ name: 'Different owner' });
  await assert.rejects(pin({ ...raw, projectId: foreign.id }, [entry]), /project|asset/i);
  const tampered = structuredClone(input) as { assetPins: Record<string, Json> }; tampered.assetPins.source = null;
  await assert.rejects(adapter.submit(tampered, context), /unpinned/);
  const file = await fileFor(project.id, asset.id), bytes = await readFile(file);
  bytes[bytes.length - 1] ^= 1; await writeFile(file, bytes);
  await assert.rejects(adapter.submit(input, context), /content changed/);
});

test('declared reader verifies actual image, video and audio bytes without exposing paths', async () => {
  const project = await createProject({ name: 'All media kinds' });
  for (const [kind, filePath] of [['image', resolve('public/logo.png')], ['video', video], ['audio', wav]] as const) {
    const asset = await importLocalProjectAsset({ projectId: project.id, filePath });
    const value = await readProjectMediaInput({ projectId: project.id, assetId: asset.id, kind, maxBytes: 64 * 1024 * 1024, signal: signal() });
    assert.deepEqual(Buffer.from(value.bytes), await readFile(filePath)); assert.equal(value.kind, kind);
    assert.equal(value.sha256, createHash('sha256').update(value.bytes).digest('hex'));
    assert.equal('file' in value || 'path' in value || 'objectKey' in value, false);
  }
});

test('reader rejects foreign membership, wrong kind, limits, cancellation, changed bytes and symlinks', async () => {
  const { project, asset } = await sourceProject(), foreign = await createProject({ name: 'Foreign' });
  const options = { projectId: project.id, assetId: asset.id, kind: 'audio' as const, maxBytes: 64 * 1024 * 1024, signal: signal() };
  await assert.rejects(readProjectMediaInput({ ...options, projectId: foreign.id }), /belonging/);
  await assert.rejects(readProjectMediaInput({ ...options, kind: 'video' }), /belonging/);
  await assert.rejects(readProjectMediaInput({ ...options, maxBytes: 1 }), /limit/);
  await assert.rejects(readProjectMediaInput({ ...options, signal: AbortSignal.abort() }));
  const original = await readProjectMediaInput(options);
  await assert.rejects(readProjectMediaInput({ ...options, expected: { ...original, sha256: '0'.repeat(64) } }), /identity/);
  const file = await fileFor(project.id, asset.id), bytes = await readFile(file), changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  await writeFile(file, changed); await assert.rejects(readProjectMediaInput(options), /content changed/);
  await rm(file); await symlink(wav, file); await assert.rejects(readProjectMediaInput(options));
  await rm(file); await writeFile(file, bytes);
});

test('actual local audio processor changes amplitude, imports output and retains the original', async () => {
  const { project, asset } = await sourceProject();
  const plan = await pin(compileRecipe(recipe, { source: asset.id, gain: 0.25, duration: 0.5 }, project.id));
  const h = new DurableHarness(':memory:');
  try {
    const run = h.enqueue(plan, 'gain');
    const adapters = { 'ext.audio-gain': createExternalAdapter(gain), 'asset.materialize': createMaterializeAdapter() };
    for (let i = 0; i < 4; i++) await h.step(run, adapters);
    const jobs = h.jobs(run); assert.deepEqual(jobs.map(job => job.state), ['succeeded', 'succeeded']);
    const saved = await readBinaryReceipt({ projectId: project.id, jobId: jobs[0].id }, signal()); assert.ok(saved);
    const decode = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-t', '0.5', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
    const rms = (bytes: Buffer) => Math.sqrt(Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4) ** 2).reduce((a, b) => a + b, 0) / (bytes.length / 4));
    const ratio = rms(decode(saved.file)) / rms(decode(wav)); assert.ok(Math.abs(ratio - 0.25) < 0.001, String(ratio));
    assert.equal(decode(saved.file).length / 4 / 48000, 0.5);
    assert.deepEqual(await readFile(await fileFor(project.id, asset.id)), await readFile(wav));
    assert.equal((await attachMaterializedJob(h, project.id, run, jobs[1].id, 0)).ok, true);
    // A published result remains recoverable even if the input is subsequently unavailable.
    await rm(await fileFor(project.id, asset.id));
    const recovered = await adapters['ext.audio-gain'].poll(jobs[0].provider_id!, JSON.parse(jobs[0].execution_input_json!), signal(), { projectId: project.id, jobId: jobs[0].id, runId: run });
    assert.equal(recovered.state, 'succeeded');
  } finally { h.close(); }
});

test('upstream materialized audio binds a complete durable identity before processing', async () => {
  const project = await createProject({ name: 'Chained audio' });
  const first = compileRecipe(JSON.parse(await readFile('../../examples/adapter-recipes/procedural-tone.json', 'utf8')), { frequency: 330, duration: 0.5 }, project.id);
  first.nodes[1].id = 'source-audio';
  const next = compileRecipe(recipe, { source: 'deferred', gain: 0.5, duration: 0.25 }, project.id);
  next.nodes[0].input = { sourceAssetId: null, gain: 0.5, duration: 0.25 };
  next.nodes[0].dependsOn = ['source-audio']; next.nodes[0].bindings = [{ node: 'source-audio', pointer: '/assetId', target: '/sourceAssetId' }];
  const plan = await pin({ projectId: project.id, nodes: [...first.nodes, ...next.nodes] }, [tone, gain]);
  const h = new DurableHarness(':memory:');
  try {
    const run = h.enqueue(plan, 'chain'), adapters = { 'ext.example-tone': createExternalAdapter(tone), 'ext.audio-gain': createExternalAdapter(gain), 'asset.materialize': createMaterializeAdapter() };
    for (let i = 0; i < 8; i++) await h.step(run, adapters);
    const jobs = h.jobs(run); assert.ok(jobs.every(job => job.state === 'succeeded'), JSON.stringify(jobs.map(j => [j.state, j.error])));
    const prior = JSON.parse(jobs[1].output_json!), resolved = JSON.parse(jobs[2].execution_input_json!);
    assert.equal(resolved.assetPins.source.assetId, prior.assetId); assert.equal(resolved.assetPins.source.sha256, prior.sha256);
    assert.equal(resolved.assetPins.source.sizeBytes, prior.sizeBytes); assert.equal(resolved.assetPins.source.projectId, project.id);
    assert.equal(resolved.payload.sourceAssetId, prior.assetId);
    // Raw bindings are validated at admission, not trusted because they return a string.
    const raw = { projectId: project.id, nodes: [...first.nodes, ...next.nodes] }; raw.nodes[2].bindings![0].pointer = '/publicUrl';
    await assert.rejects(pin(raw, [tone, gain]), /materializer/);
    raw.nodes[2].bindings![0].pointer = '/assetId'; (raw.nodes[1].input as any).kind = 'video';
    await assert.rejects(pin(raw, [tone, gain]), /kind/);
  } finally { h.close(); }
});

test('changed pinned media cannot import code or replay an ambiguous submission', async () => {
  const { project, asset } = await sourceProject();
  const module = "process.env.VH_MEDIA_IMPORTED='1'; export default { recovery:'replay', async submit(){process.env.VH_MEDIA_SUBMITS=String(Number(process.env.VH_MEDIA_SUBMITS||0)+1);throw Error('lost acknowledgement')}, async poll(){return {state:'running'}} }";
  const folder = await mkdtemp(join(directory, 'ambiguous-'));
  await writeFile(join(folder, 'audio-gain.mjs'), module);
  await writeFile(join(folder, 'audio-gain.json'), JSON.stringify({ ...gain.descriptor, sha256: createHash('sha256').update(module).digest('hex') }));
  const entry = readExternalCatalog(folder)[0], plan = await pin(compileRecipe(recipe, { source: asset.id }, project.id), [entry]); plan.nodes = plan.nodes.slice(0, 1);
  const file = await fileFor(project.id, asset.id), bytes = await readFile(file), changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  await writeFile(file, changed);
  const adapter = createExternalAdapter(entry);
  await assert.rejects(adapter.submit(plan.nodes[0].input, { key: 'invalid', projectId: project.id, jobId: 'never', dependencies: {}, signal: signal() }), /content changed/);
  assert.equal(process.env.VH_MEDIA_IMPORTED, undefined);
  await writeFile(file, bytes);
  let now = 1000; const h = new DurableHarness(':memory:', () => now);
  try {
    const run = h.enqueue(plan, 'ambiguous'); await h.step(run, { 'ext.audio-gain': adapter });
    assert.equal(process.env.VH_MEDIA_SUBMITS, '1'); await writeFile(file, changed); now += 6000;
    await h.step(run, { 'ext.audio-gain': adapter }); now += 6000;
    await h.step(run, { 'ext.audio-gain': adapter });
    assert.equal(h.jobs(run)[0].state, 'uncertain'); h.retry(run); assert.equal(h.jobs(run)[0].state, 'uncertain'); assert.equal(process.env.VH_MEDIA_SUBMITS, '1');
  } finally { h.close(); delete process.env.VH_MEDIA_SUBMITS; delete process.env.VH_MEDIA_IMPORTED; }
});
