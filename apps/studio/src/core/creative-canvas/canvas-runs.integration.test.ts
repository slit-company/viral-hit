import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { CanvasCard, CanvasGenerationCard, CanvasOutputCard } from './canvas-types';

const directory = await mkdtemp(join(tmpdir(), 'vh-canvas-runs-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
process.env.VIRAL_HIT_PROVIDERS_DIR = join(directory, 'providers');
process.env.VIRAL_HIT_HARNESS_DB = join(directory, 'harness.db');
delete process.env.VIRAL_HIT_ADAPTERS_DIR;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => rm(directory, { recursive: true, force: true }));
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const colors = ['red', 'green', 'blue', 'yellow', 'purple', 'orange', 'white', 'gray'];
for (const [index, color] of colors.entries()) {
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64`, '-frames:v', '1', join(directory, `still-${index}.png`)]);
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=64x64:r=10:d=0.5`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(directory, `clip-${index}.mp4`)]);
}
const calls = join(directory, 'calls.jsonl');
const folder = join(process.env.VIRAL_HIT_PROVIDERS_DIR, 'canvas-fixture');
await mkdir(folder, { recursive: true });
// Every call returns different bytes, so each take is its own asset.
await writeFile(join(folder, 'provider.mjs'), `
import { appendFileSync, readFileSync } from 'node:fs';
export async function createGeneration({ model, input, signal }) {
  signal.throwIfAborted();
  let count = 0; try { count = readFileSync(${JSON.stringify(calls)}, 'utf8').split('\\n').filter(Boolean).length; } catch {}
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ model: model.id, prompt: input.prompt }) + '\\n');
  const index = count % 8, video = model.kind === 'video';
  return { status: 'succeeded', media: [{ data: readFileSync(${JSON.stringify(directory)} + (video ? '/clip-' : '/still-') + index + (video ? '.mp4' : '.png')), mimeType: video ? 'video/mp4' : 'image/png' }] };
}`);
await writeFile(join(folder, 'provider.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'canvas-fixture', label: 'Canvas fixture', scope: 'general', referenceDelivery: 'project-media', models: [
  { id: 'canvas-image', name: 'Canvas image', kind: 'image', aspectRatios: ['1:1'], maxReferenceImages: 2 },
  { id: 'canvas-video', name: 'Canvas video', kind: 'video', aspectRatios: ['1:1'], durations: ['1s'], maxReferenceImages: 1 },
] }));
const { installGenerationProviders } = await import('../generation-providers/installed/install.server');
assert.deepEqual(installGenerationProviders().problems, []);
const { createProject, loadProjectWithLatestSnapshot } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { persistViralHitCommand } = await import('../commands/persist');
const { openHarness } = await import('../harness/store');
const { createRuntimeAdapters } = await import('../harness/adapters');
const { changeCanvasRuns } = await import('./canvas-runs.server');

const callLog = async () => (await readFile(calls, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { model: string; prompt: string });
const settings = { workflowTemplateId: null, status: 'idle' as const, error: null, aspectRatio: '1:1' as const, outputQuality: '1k' as const, duration: '1s' as const,
  mode: 'quality' as const, variant: 'standard' as const, quality: 'standard' as const, sourceGenerationId: null, url: null };
async function cards(projectId: string) {
  const state = await loadProjectWithLatestSnapshot({ projectId });
  return { byId: Object.fromEntries(state!.snapshot.cards.map((card) => [card.id, card])) as Record<string, CanvasCard>, revision: state!.snapshotVersion, frames: state!.snapshot.frames };
}
async function upsert(projectId: string, ...list: CanvasCard[]) {
  const { revision } = await cards(projectId);
  const result = await persistViralHitCommand({ projectId, origin: 'ui', expectedRevision: revision, command: { type: 'canvas.apply', operations: list.map((card) => ({ type: 'upsert_card' as const, card, frame: { x: 0, y: list.indexOf(card) * 300, w: 240, h: 240 } })) } });
  assert.ok(result.ok, JSON.stringify(result));
}
/** Runs the worker until the canvas run finishes, then shows the results on the canvas. */
async function finish(projectId: string, runId: string) {
  const h = openHarness(), adapters = createRuntimeAdapters();
  try {
    for (let index = 0; index < 60; index += 1) {
      if (h.jobs(runId).every((job) => ['succeeded', 'failed', 'canceled', 'blocked', 'uncertain'].includes(job.state))) break;
      if (!await h.step(runId, adapters)) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.deepEqual(h.jobs(runId).map((job) => job.state).filter((state) => state !== 'succeeded'), [], JSON.stringify({ jobs: h.jobs(runId).map((job) => [job.node_id, job.state, job.error, job.execution_input_json ?? job.input_json]), events: h.events(runId) }));
  } finally { h.close(); }
  return changeCanvasRuns(projectId, { action: 'status' }, 'ui') as Promise<{ active: boolean }>;
}
const takesOf = (byId: Record<string, CanvasCard>, cardId: string) => Object.values(byId).filter((card): card is CanvasOutputCard => card.kind === 'output' && card.sourceConfigCardId === cardId);
const pinnedAsset = (byId: Record<string, CanvasCard>, cardId: string) => byId[(byId[cardId] as CanvasGenerationCard).pinnedOutputId!]?.assetId;

test('a canvas chain runs only what changed, branches reuse shared results, and takes appear on the canvas', async () => {
  const project = await createProject({ name: 'Canvas branches' });
  const photo = await importLocalProjectAsset({ projectId: project.id, filePath: join(directory, 'still-0.png') });
  const a: CanvasGenerationCard = { ...settings, id: 'a', kind: 'generation', type: 'image', name: 'Poster', prompt: 'A paper lantern poster', referenceCardIds: ['photo'], modelId: 'canvas-image' };
  const b: CanvasGenerationCard = { ...settings, id: 'b', kind: 'generation', type: 'video', name: 'Motion', prompt: 'The lantern sways', referenceCardIds: ['a'], modelId: 'canvas-video' };
  await upsert(project.id, { ...settings, id: 'photo', kind: 'asset', type: 'image', name: 'Photo', prompt: '', referenceCardIds: [], modelId: '', assetId: photo.id, url: photo.publicUrl }, a, b);

  const plan = await changeCanvasRuns(project.id, { action: 'plan', cardId: 'b' }, 'ui') as { plan: { steps: Array<{ cardId: string; action: string; reason: string | null }> } };
  assert.deepEqual(plan.plan.steps.map((step) => [step.cardId, step.action, step.reason]), [['a', 'run', 'no-result'], ['b', 'run', 'upstream']]);
  const first = await changeCanvasRuns(project.id, { action: 'start', cardId: 'b', requestId: randomUUID() }, 'ui') as unknown as { runId: string; active: boolean };
  assert.equal(first.active, true);
  let canvas = await cards(project.id);
  assert.deepEqual([takesOf(canvas.byId, 'a').map((take) => take.status), takesOf(canvas.byId, 'b').map((take) => take.status)], [['pending'], ['pending']], 'pending takes appear before the provider runs');
  assert.equal((await finish(project.id, first.runId)).active, false);
  canvas = await cards(project.id);
  const [aTake] = takesOf(canvas.byId, 'a'), [bTake] = takesOf(canvas.byId, 'b');
  assert.deepEqual([aTake.status, bTake.status, canvas.byId.a.status, canvas.byId.b.status], ['succeeded', 'succeeded', 'idle', 'idle']);
  assert.equal(pinnedAsset(canvas.byId, 'b'), bTake.assetId);
  assert.deepEqual(bTake.generationSnapshot.referenceAssetIds, [aTake.assetId], 'the video recorded the image it animated');
  assert.ok(canvas.frames[bTake.id], 'takes are placed next to their card');
  assert.deepEqual((await callLog()).map((call) => call.model), ['canvas-image', 'canvas-video']);

  // Nothing changed: nothing runs.
  const again = await changeCanvasRuns(project.id, { action: 'start', cardId: 'b', requestId: randomUUID() }, 'ui') as unknown as { runId: string | null; plan: { steps: Array<{ action: string }> } };
  assert.equal(again.runId, null);
  assert.deepEqual(again.plan.steps.map((step) => step.action), ['reuse', 'reuse']);

  // Only the edited card runs, from the image already made.
  await upsert(project.id, { ...(canvas.byId.b as CanvasGenerationCard), prompt: 'The lantern spins slowly' });
  const edited = await changeCanvasRuns(project.id, { action: 'start', cardId: 'b', requestId: randomUUID() }, 'ui') as unknown as { runId: string };
  await finish(project.id, edited.runId);
  canvas = await cards(project.id);
  assert.deepEqual((await callLog()).slice(2).map((call) => [call.model, call.prompt]), [['canvas-video', 'The lantern spins slowly']]);
  assert.equal(takesOf(canvas.byId, 'b').length, 2);
  assert.equal(takesOf(canvas.byId, 'a').length, 1, 'the image was reused, not made again');

  // A branch shares the photo, copies both cards, and reuses the identical image step from the durable cache.
  const branch = await changeCanvasRuns(project.id, { action: 'branch', cardId: 'a', requestId: randomUUID() }, 'ui') as { cardId: string; cardIds: string[] };
  canvas = await cards(project.id);
  const copyB = branch.cardIds.find((id) => id !== branch.cardId)!;
  assert.deepEqual((canvas.byId[copyB] as CanvasGenerationCard).referenceCardIds, [branch.cardId]);
  assert.deepEqual((canvas.byId[branch.cardId] as CanvasGenerationCard).referenceCardIds, ['photo']);
  assert.ok(canvas.frames[branch.cardId].y > canvas.frames.a.y, 'the branch sits below the original');
  await upsert(project.id, { ...(canvas.byId[copyB] as CanvasGenerationCard), prompt: 'The lantern drifts away' });
  const branched = await changeCanvasRuns(project.id, { action: 'start', cardId: copyB, requestId: randomUUID() }, 'ui') as unknown as { runId: string };
  await finish(project.id, branched.runId);
  canvas = await cards(project.id);
  assert.deepEqual((await callLog()).slice(3).map((call) => [call.model, call.prompt]), [['canvas-video', 'The lantern drifts away']], 'the copied image step came from the cache');
  assert.equal(pinnedAsset(canvas.byId, branch.cardId), aTake.assetId);
  assert.equal(takesOf(canvas.byId, copyB)[0].generationSnapshot.referenceAssetIds?.[0], aTake.assetId);
  assert.equal(takesOf(canvas.byId, 'b').length, 2, 'the original chain is untouched');

  // A busy card blocks a new run with a reason.
  await upsert(project.id, { ...(canvas.byId.a as CanvasGenerationCard), status: 'processing' });
  await assert.rejects(changeCanvasRuns(project.id, { action: 'start', cardId: 'b', requestId: randomUUID() }, 'ui'), /Poster is still generating/);
});
