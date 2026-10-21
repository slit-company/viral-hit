import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DurableHarness } from '../harness/durable';
import { createSceneAdapter, detectProjectScenes, parseSceneScores } from './scene-detection.server';
import { chooseSceneRanges, readSceneOutput } from './scene-contract';

const directory = await mkdtemp(join(tmpdir(), 'vh-scenes-test-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => rm(directory, { recursive: true, force: true }));
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { prepareRecipePlan } = await import('../harness/recipe-plan');
const { pinRuntimePlan } = await import('../harness/runtime-plan');
const { createRuntimeAdapters } = await import('../harness/adapters');
const { attachRunResult } = await import('../harness/attach-result');
const { loadProjectTimeline } = await import('../editor/timeline-state');
const { renderProjectTimelineToAsset } = await import('../editor/render-project-timeline');
const video = join(directory, 'cuts.mp4'), still = join(directory, 'still.mp4');
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=128x72:d=1:r=24', '-f', 'lavfi', '-i', 'color=blue:s=128x72:d=1:r=24', '-f', 'lavfi', '-i', 'color=green:s=128x72:d=1:r=24', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=128x72:d=1:r=24', '-c:v', 'libx264', still]);
async function fixture(file = video, values = {}) {
  const project = await createProject({ name: 'Independent scene workflow' });
  const asset = await importLocalProjectAsset({ projectId: project.id, filePath: file });
  const plan = await pinRuntimePlan(await prepareRecipePlan('detect-video-scenes', { source: asset.id, ...values }, project.id));
  return { projectId: project.id, asset, plan };
}

test('actual cuts resume after restart and produce editable clips with matching video and source audio', async () => {
  const f = await fixture(); let h = new DurableHarness(join(directory, 'durable.sqlite'));
  const run = h.enqueue(f.plan, 'scenes');
  try {
    await h.step(run, createRuntimeAdapters()); assert.equal(h.jobs(run)[0].state, 'running');
    const receipt = h.jobs(run)[0].provider_id;
    h.close(); h = new DurableHarness(join(directory, 'durable.sqlite'));
    for (let i = 0; i < 5; i++) await h.step(run, createRuntimeAdapters());
    const jobs = h.jobs(run); assert.ok(jobs.every(job => job.state === 'succeeded'), JSON.stringify(jobs.map(job => job.error)));
    assert.equal(jobs[0].provider_id, receipt);
    const output = readSceneOutput(jobs[0].output_json)!; assert.ok(output);
    assert.deepEqual(output.analysis.scenes.map(scene => [scene.start, scene.end]), [[0, 1], [1, 2], [2, 3]]);
    assert.equal(output.analysis.candidateCount, 2);
    assert.equal((await attachRunResult(h, f.projectId, run, jobs[1].id, 0)).ok, true);
    const timeline = (await loadProjectTimeline(f.projectId))!;
    const clips = timeline.document.tracks.flatMap(track => track.clips);
    assert.deepEqual(clips.map(clip => [clip.inPoint, clip.outPoint]), [[0, 1], [1, 2], [2, 3]]);
    const rendered = await renderProjectTimelineToAsset({ projectId: f.projectId, document: timeline.document, timelineRevision: timeline.version });
    for (const [at, channel] of [[.5, 0], [1.5, 2], [2.5, 1]]) {
      const pixel = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(at), '-i', rendered.localPath, '-vf', 'scale=1:1', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
      assert.ok(pixel[channel] > 80 && pixel[channel] > pixel[(channel + 1) % 3] + 60, String([...pixel]));
    }
    const pcm = execFileSync(ffmpeg, ['-v', 'error', '-i', rendered.localPath, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-']);
    let power = 0; for (let offset = 0; offset + 4 <= pcm.length; offset += 4) power += pcm.readFloatLE(offset) ** 2;
    assert.ok(Math.sqrt(power / (pcm.length / 4)) > .01, 'original audio is audible, not merely an empty stream');
    if (process.env.VH_SCENE_EVIDENCE) {
      await copyFile(rendered.localPath, join(process.env.VH_SCENE_EVIDENCE, 'three-scene-proof.mp4'));
      await copyFile(video, join(process.env.VH_SCENE_EVIDENCE, 'source.mp4'));
      await writeFile(join(process.env.VH_SCENE_EVIDENCE, 'analysis.json'), JSON.stringify(output.analysis, null, 2));
    }
  } finally { h.close(); }
});

test('static footage, sensitivity and scene limits preserve the entire source rather than dropping unselected ranges', async () => {
  const f = await fixture(still), signal = AbortSignal.timeout(30000);
  const result = await detectProjectScenes(f.projectId, f.plan.nodes[0].input, signal);
  assert.equal(result.analysis.candidateCount, 0); assert.deepEqual(result.analysis.scenes, [{ start: 0, end: 1, score: 0 }]);
  const limited = await fixture(video, { maximum: 2 });
  const merged = await detectProjectScenes(limited.projectId, limited.plan.nodes[0].input, signal);
  assert.equal(merged.analysis.scenes.length, 2); assert.equal(merged.analysis.scenes.at(-1)!.end, 3); assert.equal(merged.analysis.candidateCount, 2);
  const insensitive = await fixture(video, { threshold: 100 });
  assert.equal((await detectProjectScenes(insensitive.projectId, insensitive.plan.nodes[0].input, signal)).analysis.scenes.length, 1);
  assert.deepEqual(chooseSceneRanges([{ time: .1, score: 99 }, { time: 1, score: 50 }, { time: 1.1, score: 70 }, { time: 2.9, score: 99 }], 3, .5, 64).map(scene => [scene.start, scene.end]), [[0, 1.1], [1.1, 3]]);
  assert.throws(() => parseSceneScores('lavfi.scd.score=NaN\nlavfi.scd.time=1'), /Invalid/);
});

test('foreign media, changed bytes, changed engines and mismatched receipts cannot be used as accepted scene outputs', async () => {
  const f = await fixture(), other = await createProject({ name: 'Other' });
  await assert.rejects(pinRuntimePlan(await prepareRecipePlan('detect-video-scenes', { source: f.asset.id }, other.id)), /belonging/);
  const wrong = { ...f.plan.nodes[0].input as Record<string, unknown>, engine: '0'.repeat(64) };
  await assert.rejects(detectProjectScenes(f.projectId, wrong, AbortSignal.timeout(30000)), /tools changed/);
  const adapter = createSceneAdapter(), context = { projectId: f.projectId, runId: 'scene-run', jobId: 'scene-job', signal: AbortSignal.timeout(30000), key: 'receipt', dependencies: {} };
  const receipt = await adapter.submit(f.plan.nodes[0].input, context);
  await assert.rejects(adapter.poll(receipt.id, wrong, context.signal, context), /does not match/);
  const row = (await getProjectAssetById({ projectId: f.projectId, assetId: f.asset.id }))!;
  const path = resolveLocalProjectAssetPath(row), bytes = await readFile(path); bytes[0] ^= 1; await writeFile(path, bytes);
  await assert.rejects(adapter.poll(receipt.id, f.plan.nodes[0].input, context.signal, context), /contents changed/);
});

test('an independently composed reference workflow binds verified video identity through detection into editable sequence', async () => {
  const project = await createProject({ name: 'Composed reference workflow' });
  const asset = await importLocalProjectAsset({ projectId: project.id, filePath: video });
  const plan = await prepareRecipePlan('detect-video-scenes', { source: 'pending' }, project.id);
  plan.nodes[0].dependsOn = ['source'];
  plan.nodes[0].bindings = [{ target: '/assetId', node: 'source', pointer: '/assetId' }];
  plan.nodes.unshift({ id: 'source', operation: 'reference.sample', version: '1', input: { assetId: asset.id } });
  const pinned = await pinRuntimePlan(plan), h = new DurableHarness(join(directory, 'composed.sqlite'));
  try {
    const run = h.enqueue(pinned, 'composed');
    for (let i = 0; i < 8; i++) await h.step(run, createRuntimeAdapters());
    const jobs = h.jobs(run);
    assert.ok(jobs.every(job => job.state === 'succeeded'), JSON.stringify(jobs.map(job => job.error)));
    const output = readSceneOutput(jobs.find(job => job.operation === 'reference.scenes')!.output_json)!;
    assert.equal(output.analysis.scenes.length, 3);
    assert.equal((await attachRunResult(h, project.id, run, jobs.find(job => job.operation === 'editor.sequence')!.id, 0)).ok, true);
    const timeline = (await loadProjectTimeline(project.id))!;
    assert.deepEqual(timeline.document.tracks.flatMap(track => track.clips).map(clip => clip.assetId), [output.assetId, output.assetId, output.assetId]);
  } finally { h.close(); }
});

test('cancellation waits for the actual detector process to stop and removes its private copy', async () => {
  const wrapper = join(directory, 'slow-ffmpeg'), marker = join(directory, 'detector-started.json'), stopped = join(directory, 'detector-stopped');
  await writeFile(wrapper, '#!/usr/bin/env node\n' + `const fs=require('node:fs'),cp=require('node:child_process'); const args=process.argv.slice(2); if(args[0]==='-version'){process.stdout.write(cp.execFileSync(${JSON.stringify(ffmpeg)},args));}else{fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({input:args[args.indexOf('-i')+1]}));process.on('SIGTERM',()=>{setTimeout(()=>{fs.writeFileSync(${JSON.stringify(stopped)},'stopped');process.exit(0)},150)});setInterval(()=>{},1000);}`);
  await chmod(wrapper, 0o700); const previous = process.env.VIRAL_HIT_FFMPEG; process.env.VIRAL_HIT_FFMPEG = wrapper;
  try {
    const f = await fixture(), controller = new AbortController();
    const pending = detectProjectScenes(f.projectId, f.plan.nodes[0].input, controller.signal);
    const rejected = assert.rejects(pending, /abort|cancel/i);
    for (let i = 0; i < 100; i++) { if (await stat(marker).catch(() => null)) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    const { input } = JSON.parse(await readFile(marker, 'utf8'));
    controller.abort(); await rejected;
    assert.equal(await readFile(stopped, 'utf8'), 'stopped');
    assert.equal(await stat(dirname(input)).catch(() => null), null);
  } finally { if (previous === undefined) delete process.env.VIRAL_HIT_FFMPEG; else process.env.VIRAL_HIT_FFMPEG = previous; }
});
