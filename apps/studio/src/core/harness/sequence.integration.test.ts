import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableHarness, type Plan } from './durable';
import { compileRecipe } from './recipes';
const directory = await mkdtemp(join(tmpdir(), 'vh-editable-sequence-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(() => rm(directory, { recursive: true, force: true }));
const { createProject } = await import('../projects/projects');
const { createMaterializeAdapter } = await import('./materialize');
const { pinSequenceInputs, createSequenceAdapter, verifySequence } = await import('./sequence-adapter');
const { attachRunResult } = await import('./attach-result');
const { loadProjectTimeline } = await import('../editor/timeline-state');
const { persistViralHitCommand } = await import('../commands/persist');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { probeMedia } = await import('./probe-media');
const { runtimeNodeSchema } = await import('./requests');
const { createRuntimeAdapters } = await import('./adapters');
const { runtimeCapabilities } = await import('./capabilities');
const recipe = JSON.parse(await readFile('../../recipes/editable-image-story.json', 'utf8'));
const importAdapter = createMaterializeAdapter({ download: async (_url, destination) => copyFile('public/logo.png', destination), probe: probeMedia });
const adapters = { 'asset.materialize': importAdapter, 'editor.sequence': createSequenceAdapter() };
async function setup() {
  const project = await createProject({ name: 'Editable sequence' }), file = join(directory, project.id + '.sqlite'), h = new DurableHarness(file);
  const run = h.enqueue({ projectId: project.id, nodes: [{ id: 'image', operation: 'asset.materialize', version: '1', input: { kind: 'image', url: 'https://example.invalid/image.png' } }] }, 'import');
  for (let i = 0; i < 2; i++) await h.step(run, adapters);
  const assetId: string = JSON.parse(h.jobs(run)[0].output_json!).assetId;
  return { project, file, h, assetId, plan: compileRecipe(recipe, { image: assetId, title: 'ORIGINAL', duration: 3 }, project.id) };
}
test('sequence prepares without timeline writes, survives reopen and appends once at the reviewed revision', async () => {
  const f = await setup(); let h = f.h;
  try {
    const plan = await pinSequenceInputs(f.plan); assert.equal(runtimeNodeSchema.parse(f.plan.nodes[0]).operation, 'editor.sequence');
    assert.ok(createRuntimeAdapters()['editor.sequence']); assert.equal(runtimeCapabilities().find(c => c.operation === 'editor.sequence')?.configured, true);
    const run = h.enqueue(plan, 'edit'); await h.step(run, adapters); h.close(); h = new DurableHarness(f.file); await h.step(run, adapters);
    const job = h.jobs(run)[0]; assert.equal(job.state, 'succeeded'); assert.equal(job.attempts, 1); assert.equal(await loadProjectTimeline(f.project.id), null);
    await persistViralHitCommand({ projectId: f.project.id, origin: 'ui', commandId: 'preceding-edit', expectedRevision: 0, command: { type: 'editor.apply', operations: [{ type: 'add_clip', clipId: 'existing', sourceType: 'image', sourceUrl: '', assetId: f.assetId, sourceDuration: 2, name: 'Keep me' }] } });
    assert.equal((await attachRunResult(h, f.project.id, run, job.id, 0)).ok, false);
    const before = (await loadProjectTimeline(f.project.id))!;
    const result = await attachRunResult(h, f.project.id, run, job.id, before.version); assert.equal(result.ok, true);
    const saved = (await loadProjectTimeline(f.project.id))!; assert.equal(saved.document.duration, 5);
    for (const track of before.document.tracks.filter(track => track.clips.length || track.locked)) assert.deepEqual(saved.document.tracks.find(candidate => candidate.id === track.id), track);
    const caption = saved.document.tracks.flatMap(t => t.clips).find(c => c.sourceType === 'caption')!;
    await persistViralHitCommand({ projectId: f.project.id, origin: 'ui', commandId: 'edit-title', expectedRevision: saved.version, command: { type: 'editor.apply', operations: [{ type: 'upsert_caption', clipId: caption.id, text: 'CHANGED', startTime: caption.startTime, duration: caption.duration }] } });
    assert.deepEqual(await attachRunResult(h, f.project.id, run, job.id, before.version), result);
    assert.equal((await loadProjectTimeline(f.project.id))!.document.tracks.flatMap(t => t.clips).find(c => c.id === caption.id)!.text, 'CHANGED');
    await assert.rejects(attachRunResult(h, f.project.id, run, job.id, saved.version, 'existing'), /single clip/);
    const other = await createProject({ name: 'Other' }); await assert.rejects(attachRunResult(h, other.id, run, job.id, 0), /not found/);
  } finally { h.close(); }
});
test('admission and acceptance reject foreign assets, missing pins, changed bytes and cancellation', async () => {
  const { h, project, assetId, plan } = await setup();
  try {
    const other = await createProject({ name: 'Other' }); await assert.rejects(pinSequenceInputs({ ...plan, projectId: other.id }), /belonging/);
    await assert.rejects(verifySequence(plan.nodes[0].input, project.id, AbortSignal.timeout(5000)), /pins/);
    const pinned = await pinSequenceInputs(plan); await assert.rejects(pinSequenceInputs(pinned), /already pinned/);
    const run = h.enqueue(pinned, 'tamper'); await h.step(run, adapters); await h.step(run, adapters);
    const asset = (await getProjectAssetById({ projectId: project.id, assetId }))!;
    const path = resolveLocalProjectAssetPath({ objectKey: asset.objectKey }), original = await readFile(path), changed = Buffer.from(original);
    changed[changed.length - 1] ^= 1; await writeFile(path, changed);
    await assert.rejects(attachRunResult(h, project.id, run, h.jobs(run)[0].id, 0), /content changed/);
    assert.equal(await loadProjectTimeline(project.id), null); await writeFile(path, original);
    const canceled = h.enqueue(pinned, 'canceled'); h.cancel(canceled);
    await assert.rejects(attachRunResult(h, project.id, canceled, h.jobs(canceled)[0].id, 0), /successfully prepared/);
  } finally { h.close(); }
});
test('materializers bind full identity; provider and metadata bindings cannot impersonate sources', async () => {
  const { h, project, plan } = await setup();
  try {
    const node = structuredClone(plan.nodes[0]); node.dependsOn = ['source']; node.bindings = [{ target: '/assets/image/assetId', node: 'source', pointer: '/assetId' }];
    const linked: Plan = { projectId: project.id, nodes: [{ id: 'source', operation: 'asset.materialize', version: '1', input: { kind: 'image', url: 'https://example.invalid/image.png' } }, node] };
    const pinned = await pinSequenceInputs(linked); assert.equal(pinned.nodes[1].bindings!.length, 6);
    const run = h.enqueue(pinned, 'linked'); for (let i = 0; i < 4; i++) await h.step(run, adapters);
    assert.ok(h.jobs(run).every(job => job.state === 'succeeded'));
    assert.equal((await attachRunResult(h, project.id, run, h.jobs(run)[1].id, 0)).ok, true);
    for (const target of ['/assets', '/assets/image/kind', '/pins', '/pins/image/sha256']) {
      const bad = structuredClone(linked); bad.nodes[1].bindings![0].target = target; await assert.rejects(pinSequenceInputs(bad), /bindings/);
    }
    const wrong = structuredClone(linked); wrong.nodes[0].operation = 'comfy.router'; await assert.rejects(pinSequenceInputs(wrong), /same-kind/);
    const mismatch = structuredClone(linked); mismatch.nodes[0].input = { kind: 'audio', url: 'https://example.invalid/audio.wav' }; await assert.rejects(pinSequenceInputs(mismatch), /same-kind/);
  } finally { h.close(); }
});
