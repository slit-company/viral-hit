import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableHarness, type Plan } from '../harness/durable';
import { createMaterializeAdapter } from '../harness/materialize';
import { probeMedia } from '../harness/probe-media';
import { createReferenceAdapter } from './recipe-adapters.server';
import { pinReferencePlan } from './recipe-plan.server';

const directory = await mkdtemp(join(tmpdir(), 'vh-reference-recipes-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { attachMaterializedJob } = await import('../harness/attach-asset');
const { loadProjectTimeline } = await import('../editor/timeline-state');
const { prepareRecipePlan } = await import('../harness/recipe-plan');
const { pinRuntimePlan } = await import('../harness/runtime-plan');
const video = join(directory, 'source.mp4');
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=128x72:d=1:r=10', '-c:v', 'libx264', video]);
const signal = () => AbortSignal.timeout(20000);
async function fixture() {
  const project = await createProject({ name: 'Reference recipe' });
  const asset = await importLocalProjectAsset({ projectId: project.id, filePath: video });
  return { project, asset };
}
test('recipe admission, durable restart, source deletion recovery and timeline attachment share real reference assets', async () => {
  const { project, asset } = await fixture();
  const plan = await pinRuntimePlan(await prepareRecipePlan('project-video-reference', { source: asset.id }, project.id));
  let h = new DurableHarness(join(directory, 'harness.sqlite'));
  const run = h.enqueue(plan, 'sample'), adapters = { 'reference.sample': createReferenceAdapter('reference.sample') };
  try {
    await h.step(run, adapters);
    assert.equal(h.jobs(run)[0].state, 'running');
    h.close(); h = new DurableHarness(join(directory, 'harness.sqlite'));
    const row = await getProjectAssetById({ projectId: project.id, assetId: asset.id }); assert.ok(row);
    await rm(resolveLocalProjectAssetPath({ objectKey: row.objectKey }));
    // Replayed submit recovers the retained original even after the selected upload is gone.
    const job = h.jobs(run)[0];
    const replay = await adapters['reference.sample'].submit(JSON.parse(job.input_json), { key: job.idempotency_key, dependencies: {}, signal: signal(), projectId: project.id, runId: run, jobId: job.id });
    assert.equal(replay.id, job.provider_id);
    await h.step(run, adapters);
    const done = h.jobs(run)[0]; assert.equal(done.state, 'succeeded');
    const output = JSON.parse(done.output_json!);
    assert.equal(output.kind, 'video'); assert.equal(output.reference.samples.length, 5);
    assert.deepEqual(output.reference.samples.map((sample: {atMs:number}) => sample.atMs), [0, 200, 500, 700, 900]);
    const attached = await attachMaterializedJob(h, project.id, run, done.id, 0);
    assert.equal(attached.ok, true);
    const timeline = await loadProjectTimeline(project.id);
    assert.equal(timeline?.document.tracks[0].clips[0].assetId, output.assetId);
  } finally { h.close(); }
});
test('reference sampling accepts a video materializer dependency with complete project identity binding', async () => {
  const project = await createProject({ name: 'Chained reference' });
  const plan: Plan = { projectId: project.id, nodes: [
    { id: 'media', operation: 'asset.materialize', version: '1', input: { url: 'https://example.invalid/video', kind: 'video' } },
    { id: 'samples', operation: 'reference.sample', version: '1', input: { assetId: '' }, dependsOn: ['media'],
      bindings: [{ node: 'media', pointer: '/assetId', target: '/assetId' }] },
  ] };
  const pinned = await pinReferencePlan(plan);
  assert.equal(pinned.nodes[1].bindings?.length, 6);
  const h = new DurableHarness(':memory:'), run = h.enqueue(pinned, 'chain');
  try {
    const adapters = { 'asset.materialize': createMaterializeAdapter({ download: async (_url, file) => { await copyFile(video, file); }, probe: probeMedia }),
      'reference.sample': createReferenceAdapter('reference.sample') };
    for (let step = 0; step < 4; step++) await h.step(run, adapters);
    assert.deepEqual(h.jobs(run).map(job => job.state), ['succeeded', 'succeeded'], JSON.stringify(h.jobs(run).map(job => ({state:job.state,error:job.error}))));
    const execution = JSON.parse(h.jobs(run)[1].execution_input_json!);
    assert.equal(execution.pin.projectId, project.id); assert.equal(execution.pin.assetId, execution.assetId);
    const wrong = structuredClone(plan); wrong.nodes[0].input = { url: '', kind: 'image' };
    await assert.rejects(pinReferencePlan(wrong), /video asset-producing/);
  } finally { h.close(); }
});
test('foreign assets, invented pins, direct paths and source mutations cannot enter sampling', async () => {
  const { project, asset } = await fixture(), other = await createProject({ name: 'Foreign' });
  const plan = (projectId: string): Plan => ({ projectId, nodes: [{ id: 'ref', operation: 'reference.sample', version: '1', input: { assetId: asset.id } }] });
  await assert.rejects(pinReferencePlan(plan(other.id)), /belonging/);
  const pinned = await pinReferencePlan(plan(project.id));
  await assert.rejects(pinReferencePlan(pinned), /already pinned/);
  const raw = structuredClone(plan(project.id)); raw.nodes[0].input = { file: video };
  await assert.rejects(pinReferencePlan(raw));
  const row = await getProjectAssetById({ projectId: project.id, assetId: asset.id }); assert.ok(row);
  const file = resolveLocalProjectAssetPath({ objectKey: row.objectKey }), bytes = await readFile(file);
  bytes[0] ^= 1; await writeFile(file, bytes);
  await assert.rejects(createReferenceAdapter('reference.sample').submit(pinned.nodes[0].input, { key: 'mutation', dependencies: {}, signal: signal(), projectId: project.id }), /contents changed/);
});

test('independent extension consumes a sampled reference through complete verified dependency pins', async () => {
  const { project, asset } = await fixture();
  const { createHash } = await import('node:crypto');
  const { mkdir } = await import('node:fs/promises');
  const { readExternalCatalog, pinExternalAdapters } = await import('../harness/external-catalog');
  const { pinExternalMediaInputs } = await import('../harness/external-media-inputs');
  const { createExternalAdapter } = await import('../harness/external-adapters');
  const adapterDirectory = join(directory, 'extension'); await mkdir(adapterDirectory);
  const source = `export default {recovery:'replay',async submit(input,context){const media=await context.readAsset('video');return {id:JSON.stringify({bytes:media.bytes.length,sha256:media.sha256})}},async poll(id){return {state:'succeeded',output:JSON.parse(id)}}};`;
  await writeFile(join(adapterDirectory, 'inspect.mjs'), source);
  await writeFile(join(adapterDirectory, 'inspect.json'), JSON.stringify({ schemaVersion: 1, operation: 'ext.inspect-video', version: '1', label: 'Inspect source', author: 'Independent fixture', license: 'Apache-2.0', entry: 'inspect.mjs', sha256: createHash('sha256').update(source).digest('hex'), recovery: 'replay', generation: false, configuration: [], assetInputs: [{ id: 'video', pointer: '/assetId', kind: 'video', maxBytes: 1024 * 1024 }], inputSchema: { type: 'object', properties: { assetId: { type: 'string' } }, required: ['assetId'], additionalProperties: false } }));
  const entries = readExternalCatalog(adapterDirectory);
  const plan: Plan = { projectId: project.id, nodes: [
    { id: 'samples', operation: 'reference.sample', version: '1', input: { assetId: asset.id } },
    { id: 'inspect', operation: 'ext.inspect-video', version: '1', input: { assetId: '' }, dependsOn: ['samples'], bindings: [{ node: 'samples', pointer: '/assetId', target: '/assetId' }] },
  ] };
  const pinned = await pinExternalMediaInputs(pinExternalAdapters(await pinReferencePlan(plan), entries), entries);
  const h = new DurableHarness(':memory:'), run = h.enqueue(pinned, 'external-reference');
  try {
    const adapters = { 'reference.sample': createReferenceAdapter('reference.sample'), 'ext.inspect-video': createExternalAdapter(entries[0]) };
    for (let step = 0; step < 4; step++) await h.step(run, adapters);
    assert.deepEqual(h.jobs(run).map(job => job.state), ['succeeded', 'succeeded']);
    const original = JSON.parse(h.jobs(run)[0].output_json!), external = JSON.parse(h.jobs(run)[1].output_json!);
    assert.equal(external.bytes, original.sizeBytes); assert.equal(external.sha256, original.sha256);
  } finally { h.close(); }
});
