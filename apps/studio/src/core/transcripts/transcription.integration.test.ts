import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DurableHarness } from '../harness/durable';
import { readTranscriptOutput } from './contract';

const directory = await mkdtemp(join(tmpdir(), 'vh-transcript-test-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
const adaptersDir = join(directory, 'adapters'), recipesDir = join(directory, 'recipes');
await mkdir(adaptersDir); await mkdir(recipesDir);
const { prepareWhisperFixture } = await import('../../../scripts/e2e-whisper-fixture.mjs');
Object.assign(process.env, await prepareWhisperFixture(directory, adaptersDir, recipesDir));
process.env.VIRAL_HIT_ADAPTERS_DIR = adaptersDir; process.env.VIRAL_HIT_RECIPES_DIR = recipesDir;
process.env.VIRAL_HIT_FFMPEG ||= execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
process.env.VIRAL_HIT_FFPROBE ||= execFileSync('which', ['ffprobe'], { encoding: 'utf8' }).trim();
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(() => rm(directory, { recursive: true, force: true }));
const { createProject } = await import('../projects/projects');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { prepareRecipePlan } = await import('../harness/recipe-plan');
const { pinRuntimePlan } = await import('../harness/runtime-plan');
const { createRuntimeAdapters } = await import('../harness/adapters');
const { attachRunResult } = await import('../harness/attach-result');
const { loadProjectTimeline } = await import('../editor/timeline-state');
const { renderProjectTimelineToAsset } = await import('../editor/render-project-timeline');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const ffmpeg = process.env.VIRAL_HIT_FFMPEG;
const video = join(directory, 'video.mp4'), audio = join(directory, 'audio.wav'), silent = join(directory, 'no-audio.mp4');
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x243d4a:s=320x180:d=2:r=24', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
execFileSync(ffmpeg, ['-v', 'error', '-i', video, '-vn', audio]);
execFileSync(ffmpeg, ['-v', 'error', '-i', video, '-an', '-c:v', 'copy', silent]);
async function fixture(kind: 'video' | 'audio' = 'video', file = kind === 'video' ? video : audio) {
  const project = await createProject({ name: 'Transcript contract integration' });
  const source = await importLocalProjectAsset({ projectId: project.id, filePath: file });
  const cover = kind === 'audio' ? await importLocalProjectAsset({ projectId: project.id, filePath: resolve('public/logo.png') }) : null;
  const plan = await pinRuntimePlan(await prepareRecipePlan(`local-transcription-${kind}-captions`, { source: source.id, ...(cover ? { cover: cover.id } : {}) }, project.id));
  return { project, source, plan };
}

test('optional video recognizer uses pinned source, survives restart and renders independently editable caption clips', async () => {
  const f = await fixture(); const file = join(directory, 'video-harness.db'); let h = new DurableHarness(file);
  try {
    const run = h.enqueue(f.plan, 'video'); await h.step(run, createRuntimeAdapters());
    assert.equal(h.jobs(run)[0].state, 'running'); const receipt = h.jobs(run)[0].provider_id;
    h.close(); h = new DurableHarness(file);
    for (let i = 0; i < 5; i++) await h.step(run, createRuntimeAdapters());
    const jobs = h.jobs(run); assert.ok(jobs.every(job => job.state === 'succeeded'), JSON.stringify(jobs.map(job => job.error)));
    assert.equal(jobs[0].provider_id, receipt); const output = readTranscriptOutput(jobs[0].output_json)!;
    assert.equal(output.source.assetId, f.source.id); assert.equal(output.engine.model, 'protocol-fixture'); assert.equal(output.segments.length, 2);
    assert.equal((await attachRunResult(h, f.project.id, run, jobs[1].id, 0)).ok, true);
    const timeline = (await loadProjectTimeline(f.project.id))!;
    const captions = timeline.document.tracks.flatMap(track => track.clips).filter(clip => clip.sourceType === 'caption');
    assert.deepEqual(captions.map(clip => [clip.text, clip.startTime, clip.duration]), [['Fixture speech', 0, .8], ['Editable captions', 1.1, .7]]);
    const result = await renderProjectTimelineToAsset({ projectId: f.project.id, document: timeline.document, timelineRevision: timeline.version });
    const rgb = execFileSync(ffmpeg, ['-v', 'error', '-ss', '0.4', '-i', result.localPath, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 24 * 1024 * 1024 });
    let white = 0; for (let i = 0; i + 2 < rgb.length; i += 3) if (rgb[i] > 200 && rgb[i + 1] > 200 && rgb[i + 2] > 200) white++;
    assert.ok(white > 20, 'caption pixels appear over the dark source');
    const pcm = execFileSync(ffmpeg, ['-v', 'error', '-i', result.localPath, '-vn', '-ar', '8000', '-ac', '1', '-f', 'f32le', '-']);
    let power = 0; for (let i = 0; i + 4 <= pcm.length; i += 4) power += pcm.readFloatLE(i) ** 2;
    assert.ok(Math.sqrt(power / (pcm.length / 4)) > .01, 'source audio remains audible');
  } finally { h.close(); }
});

test('audio recordings compose with an explicitly selected cover instead of requiring a video-only workflow', async () => {
  const f = await fixture('audio'), h = new DurableHarness(join(directory, 'audio-harness.db'));
  try {
    const run = h.enqueue(f.plan, 'audio'); for (let i = 0; i < 6; i++) await h.step(run, createRuntimeAdapters());
    const jobs = h.jobs(run); assert.ok(jobs.every(job => job.state === 'succeeded'), JSON.stringify(jobs.map(job => job.error)));
    assert.equal(readTranscriptOutput(jobs[0].output_json)!.source.kind, 'audio');
    assert.equal((await attachRunResult(h, f.project.id, run, jobs[1].id, 0)).ok, true);
    const clips = (await loadProjectTimeline(f.project.id))!.document.tracks.flatMap(track => track.clips);
    assert.deepEqual(clips.map(clip => clip.sourceType).sort(), ['audio', 'caption', 'caption', 'image']);
  } finally { h.close(); }
});

test('foreign media, a video without audio, altered originals and changed pinned tool configuration cannot become a transcript', async () => {
  const f = await fixture(), other = await createProject({ name: 'Other' });
  await assert.rejects(pinRuntimePlan(await prepareRecipePlan('local-transcription-video-captions', { source: f.source.id }, other.id)), /belonging/);
  const context = { projectId: f.project.id, runId: 'run', jobId: 'job', key: 'key', signal: AbortSignal.timeout(20000), dependencies: {} };
  const adapter = createRuntimeAdapters()['ext.whisper-transcribe'];
  const receipt = await adapter.submit(f.plan.nodes[0].input, context);
  const originalHash = process.env.VIRAL_HIT_WHISPER_MODEL_SHA256!;
  process.env.VIRAL_HIT_WHISPER_MODEL_SHA256 = '0'.repeat(64);
  try { await assert.rejects(adapter.poll(receipt.id, f.plan.nodes[0].input, context.signal, context), /changed or was not pinned/); }
  finally { process.env.VIRAL_HIT_WHISPER_MODEL_SHA256 = originalHash; }
  const row = (await getProjectAssetById({ projectId: f.project.id, assetId: f.source.id }))!;
  const path = resolveLocalProjectAssetPath(row), bytes = await readFile(path); bytes[0] ^= 1; await writeFile(path, bytes);
  await assert.rejects(adapter.poll(receipt.id, f.plan.nodes[0].input, context.signal, context), /content changed/);
  const noAudio = await fixture('video', silent), noAudioContext = { ...context, projectId: noAudio.project.id };
  const accepted = await adapter.submit(noAudio.plan.nodes[0].input, noAudioContext);
  await assert.rejects(adapter.poll(accepted.id, noAudio.plan.nodes[0].input, context.signal, noAudioContext), /audio stream/);
});
