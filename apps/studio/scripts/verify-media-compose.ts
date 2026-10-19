// Real vid2/music2 execution, project asset bindings, durable receipts and timeline export.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Adapter, Plan } from '../src/core/harness/durable';

const studio = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(studio);
const destination = process.argv[2];
const ffmpeg = process.env.VIRAL_HIT_FFMPEG, ffprobe = process.env.VIRAL_HIT_FFPROBE;
if (!destination || !isAbsolute(destination) || !ffmpeg || !ffprobe) throw Error('Pass an absolute evidence directory and configured FFmpeg/ffprobe');
await mkdir(destination, { recursive: true });
const evidence = await mkdtemp(join(destination, 'run-'));
const extension = resolve(studio, '../../extensions/local-media');
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: extension, stdio: 'pipe' });
process.env.VIRAL_HIT_DATA_DIR = join(evidence, 'data');
process.env.VIRAL_HIT_LOCAL_MEDIA_DIR = extension;
process.env.VIRAL_HIT_ADAPTERS_DIR = join(extension, 'dist/adapters');
await mkdir(process.env.VIRAL_HIT_DATA_DIR, { recursive: true });
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { cwd: studio, env: process.env, stdio: 'pipe' });
const { openHarness } = await import('../src/core/harness/store');
const { readExternalCatalog, pinExternalAdapters, externalEnvelope } = await import('../src/core/harness/external-catalog');
const { pinExternalMediaInputs } = await import('../src/core/harness/external-media-inputs');
const { createExternalAdapter } = await import('../src/core/harness/external-adapters');
const { createMaterializeAdapter } = await import('../src/core/harness/materialize');
const { compileRecipe } = await import('../src/core/harness/recipes');
const { createProject } = await import('../src/core/projects/projects');
const { importLocalProjectAsset } = await import('../src/core/projects/import-local-asset');
const { getProjectAssetById } = await import('../src/core/workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../src/core/projects/local-project-assets');
const { attachMaterializedJob } = await import('../src/core/harness/attach-asset');
const { loadProjectTimeline } = await import('../src/core/editor/timeline-state');
const { renderProjectTimelineToAsset } = await import('../src/core/editor/render-project-timeline');
const entries = readExternalCatalog(process.env.VIRAL_HIT_ADAPTERS_DIR);
const adapters: Record<string, Adapter> = { ...Object.fromEntries(entries.map(entry => [entry.descriptor.operation, createExternalAdapter(entry)])), 'asset.materialize': createMaterializeAdapter() };
const project = await createProject({ name: 'Project media composition verification' });
const imageFile = resolve(studio, 'public/brand/viral-hit-key-visual.png');
const voiceFile = join(evidence, 'voice-test-tone.wav');
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4:sample_rate=48000', '-af', 'volume=0.45', voiceFile]);
const image = await importLocalProjectAsset({ projectId: project.id, filePath: imageFile });
const voice = await importLocalProjectAsset({ projectId: project.id, filePath: voiceFile });
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const originals = { image: hash(await readFile(imageFile)), voice: hash(await readFile(voiceFile)) };

async function recipe(name: string, values: Record<string, unknown>, prefix: string) {
  const raw = JSON.parse(await readFile(join(extension, 'recipes', `${name}.json`), 'utf8'));
  const plan = compileRecipe(raw, values, project.id);
  for (const node of plan.nodes) {
    node.id = `${prefix}-${node.id}`;
    node.dependsOn = node.dependsOn?.map(id => `${prefix}-${id}`);
    node.bindings = node.bindings?.map(binding => ({ ...binding, node: `${prefix}-${binding.node}` }));
  }
  return plan.nodes;
}
const music = await recipe('music2-render', {}, 'music');
const motion = await recipe('vid2-image-motion', { image: image.id, title: 'MAKE IT MOVE' }, 'motion');
const mixed = await recipe('vid2-narrated-scene', { video: 'deferred', image: image.id, music: 'deferred', voice: voice.id, title: 'YOUR NEXT FRAME' }, 'mixed');
mixed[0].dependsOn = ['music-asset', 'motion-asset'];
mixed[0].bindings = [
  { node: 'music-asset', pointer: '/assetId', target: '/assets/audio-1' },
  { node: 'motion-asset', pointer: '/assetId', target: '/assets/video-1' },
];
const plan: Plan = await pinExternalMediaInputs(pinExternalAdapters({ projectId: project.id, nodes: [...music, ...motion, ...mixed] }, entries), entries);
const h = openHarness(), results = [];
try {
  const start = performance.now(), run = h.enqueue(plan, 'media-chain');
  for (let i = 0; i < 12; i++) {
    await h.step(run, adapters);
    const failed = h.jobs(run).filter(job => ['failed', 'uncertain'].includes(job.state));
    assert.equal(failed.length, 0, JSON.stringify(failed.map(job => ({ node: job.node_id, state: job.state, error: job.error }))));
  }
  const jobs = h.jobs(run);
  assert.ok(jobs.every(job => job.state === 'succeeded'), JSON.stringify(jobs.map(job => [job.node_id, job.state])));
  for (const name of ['motion', 'mixed']) {
    const job = jobs.find(job => job.node_id === `${name}-compose`)!;
    const materialized = jobs.find(job => job.node_id === `${name}-asset`)!;
    assert.equal(job.attempts, 1);
    const output = JSON.parse(materialized.output_json!);
    const asset = await getProjectAssetById({ projectId: project.id, assetId: output.assetId }); assert.ok(asset);
    const path = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
    const file = join(evidence, `${name}.mp4`); await copyFile(path, file);
    const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
    const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
    assert.equal(video.width, name === 'motion' ? 720 : 1280); assert.equal(video.height, name === 'motion' ? 1280 : 720);
    assert.equal(Number(video.nb_read_frames), 120); assert.equal(Number(video.duration), 4);
    execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-'], { stdio: 'pipe' });
    for (const [index, at] of [0.5, 2, 3.5].entries()) execFileSync(ffmpeg, ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', join(evidence, `${name}-${index}.png`)]);
    if (name === 'mixed') {
      assert.ok(probe.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio'));
      const samples = execFileSync(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
      let energy = 0, real = 0, imaginary = 0;
      for (let i = 0; i < samples.length / 4; i++) {
        const value = samples.readFloatLE(i * 4); energy += value ** 2;
        real += value * Math.cos(2 * Math.PI * 880 * i / 48000); imaginary += value * Math.sin(2 * Math.PI * 880 * i / 48000);
      }
      assert.ok(Math.sqrt(energy / (samples.length / 4)) > 0.005, 'mix must not be silent');
      assert.ok(Math.hypot(real, imaginary) / (samples.length / 4) > 0.005, 'narration input test tone must survive the mix');
      const envelope = externalEnvelope.parse(JSON.parse(job.execution_input_json!));
      assert.equal(envelope.assetPins!['audio-1']?.assetId, JSON.parse(jobs.find(job => job.node_id === 'music-asset')!.output_json!).assetId);
      assert.equal(envelope.assetPins!['video-1']?.assetId, JSON.parse(jobs.find(job => job.node_id === 'motion-asset')!.output_json!).assetId);
      assert.equal(envelope.assetPins!['image-2'], null);
      assert.equal((await attachMaterializedJob(h, project.id, run, materialized.id, 0)).ok, true);
    }
    const recovered = await adapters['ext.vid2-compose'].poll(job.provider_id!, JSON.parse(job.execution_input_json!), AbortSignal.timeout(2000), { projectId: project.id, runId: run, jobId: job.id });
    assert.equal(recovered.state, 'succeeded');
    results.push({ name, file, assetId: output.assetId, sha256: hash(await readFile(file)), probe });
  }
  assert.equal(hash(await readFile(imageFile)), originals.image); assert.equal(hash(await readFile(voiceFile)), originals.voice);
  for (const [assetId, expected] of [[image.id, originals.image], [voice.id, originals.voice]]) {
    const original = await getProjectAssetById({ projectId: project.id, assetId }); assert.ok(original);
    assert.equal(hash(await readFile(resolveLocalProjectAssetPath({ objectKey: original.objectKey }))), expected, 'retained project original must remain unchanged');
  }
  const timeline = await loadProjectTimeline(project.id); assert.ok(timeline);
  const exported = await renderProjectTimelineToAsset({ projectId: project.id, document: timeline.document, timelineRevision: timeline.version });
  await copyFile(exported.localPath, join(evidence, 'editor-export.mp4'));
  execFileSync(ffmpeg, ['-v', 'error', '-i', exported.localPath, '-f', 'null', '-'], { stdio: 'pipe' });
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ projectId: project.id, runId: run, elapsedMs: performance.now() - start, inputs: { ...originals, narration: 'Synthetic 880 Hz test tone, not a speech model' }, results }, null, 2));
  console.log(`Actual music2 → project audio + image → vid2 video → mixed composition → editor export passed. Evidence: ${evidence}`);
} finally { h.close(); }
