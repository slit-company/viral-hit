import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { storyboardPlan, type StoryboardState } from './contract';
import { readStoryboard, reserveAction, readAction, digest } from './storage.server';

const root = await mkdtemp(join(tmpdir(), 'vh-storyboard-'));
process.env.VIRAL_HIT_DATA_DIR = root;
delete process.env.VIRAL_HIT_HARNESS_DB;
const adapters = join(root, 'adapters'); await mkdir(adapters);
process.env.VIRAL_HIT_ADAPTERS_DIR = adapters;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => rm(root, { recursive: true, force: true }));
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const pictures: Record<string, string> = {};
for (const color of ['red', 'blue']) {
  const file = join(root, color + '.png');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=' + color + ':s=128x72', '-frames:v', '1', file]);
  pictures[color] = (await readFile(file)).toString('base64');
}
const source = 'const pictures = ' + JSON.stringify(pictures) + '; export default { recovery:"replay", async submit(input,context){return {id:context.key}}, async poll(id,input,signal,context){ const previous=await context.readBinary(); if(previous)return {state:"succeeded",output:previous}; const output=await context.publishBinary(Buffer.from(pictures[input.color],"base64"),{contentType:"image/png",model:"procedural-color-fixture",providerJobId:id,creditsUsed:"0"}); return {state:"succeeded",output};} };';
await writeFile(join(adapters, 'color.mjs'), source);
await writeFile(join(adapters, 'color.json'), JSON.stringify({
  schemaVersion: 1, operation: 'ext.storyboard-color', version: '1', label: 'Procedural color fixture', author: 'Test', license: 'MIT',
  entry: 'color.mjs', sha256: createHash('sha256').update(source).digest('hex'), recovery: 'replay', generation: false, configuration: [],
  inputSchema: { type: 'object', additionalProperties: false, required: ['color'], properties: { color: { type: 'string', enum: ['red', 'blue'] } } },
}));
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { changeStoryboards } = await import('./service.server');
const { inspectRecipe, installRecipe } = await import('../harness/recipe-library');
const { openHarness } = await import('../harness/store');
const { createRuntimeAdapters } = await import('../harness/adapters');
const { attachRunResult } = await import('../harness/attach-result');
const { loadProjectTimeline } = await import('../editor/timeline-state');
const { renderProjectTimelineToAsset } = await import('../editor/render-project-timeline');
const { storyboardsPost } = await import('../../routes/api/app/projects/$projectId/storyboards/-http.server');
const recipe = {
  schemaVersion: 1, id: 'storyboard-color', version: '1.0.0', title: 'Independent color processor', description: 'A real local PNG, no AI model',
  author: 'Independent author', license: 'MIT', category: 'image',
  parameters: [{ id: 'color', label: 'Color', type: 'enum', options: ['red', 'blue'], default: 'red' }],
  nodes: [
    { id: 'paint', operation: 'ext.storyboard-color', version: '1', input: { color: 'red' }, parameters: [{ parameter: 'color', target: '/color' }] },
    { id: 'image', operation: 'asset.materialize', version: '1', input: { receipt: null, kind: 'image', label: 'Color study' },
      dependsOn: ['paint'], bindings: [{ node: 'paint', pointer: '/binaryReceipt', target: '/receipt' }] },
  ],
};
const review = await inspectRecipe(recipe); await installRecipe(recipe, review.digest);
async function fixture(scope: 'general' | 'specialized' = 'general') {
  const project = await createProject({ name: 'Storyboard ' + scope });
  const uploaded = await importLocalProjectAsset({ projectId: project.id, filePath: join(root, 'red.png') });
  const asset = (await getProjectAssetById({ projectId: project.id, assetId: uploaded.id }))!;
  const plan = storyboardPlan.parse({
    schemaVersion: 1, title: scope === 'general' ? 'Two-color study' : 'Product reveal study', scope,
    intent: 'Compare two deliberate color fields without a fixed channel or brand',
    references: [{ id: 'palette', assetId: asset.id, sha256: asset.sha256, observation: 'Fixture source for a proposed color comparison', basis: 'proposed' }],
    shots: ['red', 'blue'].map(color => ({ id: color, title: color, duration: 1, direction: 'Show the ' + color + ' field',
      references: ['palette'], preserve: ['Flat field'], change: [color], avoid: ['Invented objects'], caption: color,
      recipe: { id: recipe.id, digest: review.digest, values: { color }, outputNodeId: 'image' } })),
  });
  const state = await changeStoryboards(project.id, { action: 'save', id: 'study', expectedRevision: 0, plan }) as StoryboardState;
  return { projectId: project.id, state, asset };
}
async function finish(runId: string) {
  const h = openHarness();
  try {
    for (let i = 0; i < 12 && h.jobs(runId).some(job => job.state !== 'succeeded'); i++) await h.step(runId, createRuntimeAdapters());
    assert.ok(h.jobs(runId).every(job => job.state === 'succeeded'), JSON.stringify(h.jobs(runId)));
    return h.jobs(runId);
  } finally { h.close(); }
}
const change = (projectId: string, body: unknown) => changeStoryboards(projectId, body) as Promise<StoryboardState>;

test('two independently generated shots retain reference context and assemble into an actually rendered editable movie', async () => {
  const initial = await fixture(), projectId = initial.projectId;
  const wav = join(root, 'soundtrack.wav');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', wav]);
  const uploaded = await importLocalProjectAsset({ projectId, filePath: wav });
  const audio = (await getProjectAssetById({ projectId, assetId: uploaded.id }))!;
  assert.equal(audio.durationMs, null); // Validation must measure actual bytes, not require upload metadata.
  const state = await change(projectId, { action: 'save', id: 'study', expectedRevision: 1, plan: { ...initial.state.plan, audio: [
    { id: 'tone', assetId: audio.id, sha256: audio.sha256, startTime: 0, duration: 2, inPoint: 0, role: 'music', volume: 0.2 },
  ] } });
  const requests = ['red', 'blue'].map(shotId => ({ action: 'generate', id: 'study', expectedRevision: state.revision, shotId, requestId: randomUUID() }));
  for (const request of requests) {
    const result = await changeStoryboards(projectId, request) as { runId: string };
    const replay = await changeStoryboards(projectId, request) as { runId: string };
    assert.equal(replay.runId, result.runId); await finish(result.runId);
  }
  let accepted = state;
  for (const request of requests) accepted = await change(projectId, { action: 'accept', id: 'study', expectedRevision: accepted.revision,
    shotId: request.shotId, source: { kind: 'generation', requestId: request.requestId }, notes: 'Procedural fixture; decoded pixels are checked after rendering.' });
  const assembly = await changeStoryboards(projectId, { action: 'assemble', id: 'study', expectedRevision: accepted.revision, requestId: randomUUID() }) as { runId: string };
  const jobs = await finish(assembly.runId), h = openHarness();
  try {
    const conflict = await attachRunResult(h, projectId, assembly.runId, jobs[0].id, 99); assert.equal(conflict.ok, false);
    const attached = await attachRunResult(h, projectId, assembly.runId, jobs[0].id, 0); assert.equal(attached.ok, true);
    const again = await attachRunResult(h, projectId, assembly.runId, jobs[0].id, 0); assert.deepEqual(again, attached);
  } finally { h.close(); }
  const timeline = (await loadProjectTimeline(projectId))!;
  assert.equal(timeline.document.duration, 2);
  assert.deepEqual(timeline.document.tracks.filter(track => track.kind === 'video').flatMap(track => track.clips.map(clip => [clip.startTime, clip.duration])), [[0, 1], [1, 1]]);
  const rendered = await renderProjectTimelineToAsset({ projectId, document: timeline.document, timelineRevision: timeline.version });
  const probe = JSON.parse(execFileSync(process.env.VIRAL_HIT_FFPROBE || 'ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', rendered.localPath], { encoding: 'utf8' }));
  assert.ok(probe.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio'));
  for (const [at, channel] of [[0.3, 0], [1.3, 2]]) {
    const pixel = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(at), '-i', rendered.localPath, '-vf', 'crop=8:8:0:0,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']);
    assert.ok(pixel[channel] > 180); assert.ok(pixel[channel === 0 ? 2 : 0] < 40);
  }
  if (process.env.VH_STORYBOARD_EVIDENCE) {
    await mkdir(process.env.VH_STORYBOARD_EVIDENCE, { recursive: true });
    await copyFile(rendered.localPath, join(process.env.VH_STORYBOARD_EVIDENCE, 'two-shot-proof.mp4'));
    await writeFile(join(process.env.VH_STORYBOARD_EVIDENCE, 'proof.json'), JSON.stringify({ kind: 'real local procedural processors; no AI model', duration: 2, shots: 2, revision: accepted.revision, referenceBasis: state.plan.references[0].basis, pixelOrderVerified: true }));
  }
});

test('plan revisions reject stale edits and retain only still-matching accepted shots in either scope', async () => {
  const { projectId, asset } = await fixture('specialized');
  let state = await change(projectId, { action: 'accept', id: 'study', expectedRevision: 1, shotId: 'red', source: { kind: 'asset', assetId: asset.id, sha256: asset.sha256 }, notes: 'Existing fixture source explicitly selected' });
  await assert.rejects(change(projectId, { action: 'save', id: 'study', expectedRevision: 1, plan: state.plan }), /changed/);
  const untouched = structuredClone(state.plan); untouched.shots[1].direction = 'A revised blue shot';
  state = await change(projectId, { action: 'save', id: 'study', expectedRevision: state.revision, plan: untouched }); assert.ok(state.accepted.red);
  const changed = structuredClone(state.plan); changed.references[0].observation = 'Revised source interpretation';
  state = await change(projectId, { action: 'save', id: 'study', expectedRevision: state.revision, plan: changed }); assert.deepEqual(state.accepted, {});
  assert.equal(readStoryboard(projectId, 'study', 2)!.accepted.red.assetId, asset.id);
  await assert.rejects(changeStoryboards(projectId, { action: 'assemble', id: 'study', expectedRevision: state.revision, requestId: randomUUID() }), /accepted/);
});

test('an interrupted reservation resumes its exact original recipe plan after later edits without duplicate runs', async () => {
  const { projectId, state } = await fixture();
  const req = { action: 'generate' as const, id: 'study', expectedRevision: 1, shotId: 'red', requestId: randomUUID() };
  const { prepareRecipePlan } = await import('../harness/recipe-plan');
  const { pinRuntimePlan } = await import('../harness/runtime-plan');
  const { shotDigest } = await import('./storage.server');
  const pinned = await pinRuntimePlan(await prepareRecipePlan(recipe.id, { color: 'red' }, projectId, review.digest));
  reserveAction({ projectId, boardId: 'study', requestId: req.requestId, kind: 'generate', revision: 1, shotId: 'red',
    shotDigest: shotDigest(state.plan, state.plan.shots[0]), outputNodeId: 'image', requestDigest: digest(req), plan: pinned, runId: null });
  const interrupted = openHarness();
  try { interrupted.enqueue(readAction(projectId, 'study', req.requestId)!.plan, 'storyboard:' + req.requestId); }
  finally { interrupted.close(); }
  const revised = structuredClone(state.plan); revised.shots[0].recipe!.values.color = 'blue';
  await change(projectId, { action: 'save', id: 'study', expectedRevision: 1, plan: revised });
  const resumed = await changeStoryboards(projectId, { action: 'resume', id: 'study', requestId: req.requestId }) as { runId: string };
  await changeStoryboards(projectId, { action: 'resume', id: 'study', requestId: req.requestId });
  const h = openHarness(); try { assert.equal(h.runs(projectId).length, 1); assert.ok(h.jobs(resumed.runId)[0].input_json.includes('red')); } finally { h.close(); }
  await finish(resumed.runId);
  await assert.rejects(changeStoryboards(projectId, { action: 'accept', id: 'study', expectedRevision: 2, shotId: 'red', source: { kind: 'generation', requestId: req.requestId }, notes: 'Cannot accept old intent' }), /current shot/);
  await assert.rejects(changeStoryboards(projectId, { ...req, shotId: 'blue' }), /different storyboard/);
});

test('foreign media, changed bytes, stale recipe inputs and untrusted HTTP never authorize a run', async () => {
  const a = await fixture(), b = await fixture();
  const foreign = structuredClone(a.state.plan); foreign.references[0].assetId = b.asset.id; foreign.references[0].sha256 = b.asset.sha256!;
  await assert.rejects(change(a.projectId, { action: 'save', id: 'other', expectedRevision: 0, plan: foreign }), /another project/);
  const stale = structuredClone(a.state.plan); stale.shots[0].recipe!.digest = 'f'.repeat(64);
  await change(a.projectId, { action: 'save', id: 'study', expectedRevision: 1, plan: stale });
  await assert.rejects(changeStoryboards(a.projectId, { action: 'generate', id: 'study', expectedRevision: 2, shotId: 'red', requestId: randomUUID() }), /Recipe changed/);
  const untrusted = await storyboardsPost(a.projectId, new Request('http://localhost:3808/api/app/projects/' + a.projectId + '/storyboards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }) }));
  assert.equal(untrusted.status, 403);
  await writeFile(resolveLocalProjectAssetPath({ objectKey: b.asset.objectKey }), 'changed');
  await assert.rejects(changeStoryboards(b.projectId, { action: 'generate', id: 'study', expectedRevision: 1, shotId: 'red', requestId: randomUUID() }), /invalid|hash changed/);
  const h = openHarness(); try { assert.equal(h.runs(a.projectId).length, 0); assert.equal(h.runs(b.projectId).length, 0); } finally { h.close(); }
});

test('two real CLI writers compare revisions in the same transaction', async () => {
  const { projectId, state } = await fixture();
  const body = { action: 'save', id: 'study', expectedRevision: 1, plan: { ...state.plan, title: 'Concurrent draft' } };
  const writer = () => new Promise<string>((resolve, reject) => {
    const child = execFile(process.execPath, ['--import', 'tsx', 'scripts/storyboard.ts', projectId], { env: process.env }, (error, stdout, stderr) => error ? reject(new Error(stderr)) : resolve(stdout));
    child.stdin!.end(JSON.stringify(body));
  });
  const results = await Promise.allSettled([writer(), writer()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(readStoryboard(projectId, 'study')!.revision, 2);
});

test('a lost recorded harness ledger is not recreated by resume', async () => {
  const { projectId } = await fixture(), requestId = randomUUID();
  const action = await changeStoryboards(projectId, { action: 'generate', id: 'study', expectedRevision: 1, shotId: 'red', requestId }) as { runId: string };
  const h = openHarness();
  try { h.db.prepare('DELETE FROM vh_jobs WHERE run_id=?').run(action.runId); h.db.prepare('DELETE FROM vh_runs WHERE id=?').run(action.runId); }
  finally { h.close(); }
  await assert.rejects(changeStoryboards(projectId, { action: 'resume', id: 'study', requestId }), /restore its ledger/);
  const check = openHarness(); try { assert.equal(check.runs(projectId).length, 0); } finally { check.close(); }
});
