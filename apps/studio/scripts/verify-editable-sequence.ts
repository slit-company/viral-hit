// Real project media → durable edit preparation → CLI acceptance → independent edit → FFmpeg export.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const studio = dirname(dirname(fileURLToPath(import.meta.url))); process.chdir(studio);
const destination = process.argv[2], ffmpeg = process.env.VIRAL_HIT_FFMPEG, ffprobe = process.env.VIRAL_HIT_FFPROBE;
if (!destination || !isAbsolute(destination) || !ffmpeg || !ffprobe) throw Error('Pass absolute evidence directory and FFmpeg/ffprobe paths');
await mkdir(destination, { recursive: true }); const evidence = await mkdtemp(join(destination, 'run-'));
process.env.VIRAL_HIT_DATA_DIR = join(evidence, 'data'); delete process.env.VIRAL_HIT_HARNESS_DB;
await mkdir(process.env.VIRAL_HIT_DATA_DIR);
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
const { createProject } = await import('../src/core/projects/projects');
const { importLocalProjectAsset } = await import('../src/core/projects/import-local-asset');
const { getProjectAssetById } = await import('../src/core/workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../src/core/projects/local-project-assets');
const { openHarness } = await import('../src/core/harness/store');
const { compileRecipe } = await import('../src/core/harness/recipes');
const { pinRuntimePlan } = await import('../src/core/harness/runtime-plan');
const { createRuntimeAdapters } = await import('../src/core/harness/adapters');
const { loadProjectTimeline } = await import('../src/core/editor/timeline-state');
const { persistViralHitCommand } = await import('../src/core/commands/persist');
const { renderProjectTimelineToAsset } = await import('../src/core/editor/render-project-timeline');
const project = await createProject({ name: 'Editable sequence verification' });
const sources = {
  video: join(evidence, 'scene.mp4'), image: resolve(studio, 'public/brand/viral-hit-key-visual.png'),
  music: join(evidence, 'music-tone.wav'), voice: join(evidence, 'voice-tone.wav'),
};
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x223c38:s=1280x720:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3:sample_rate=48000', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sources.video]);
for (const [kind, hz] of [['music', 330], ['voice', 880]] as const) execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=3:sample_rate=48000`, sources[kind]]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const ids: Record<string, string> = {}, originals: Record<string, string> = {};
for (const [name, file] of Object.entries(sources)) { ids[name] = (await importLocalProjectAsset({ projectId: project.id, filePath: file })).id; originals[name] = hash(await readFile(file)); }
const recipe = JSON.parse(await readFile(resolve(studio, '../../recipes/editable-scene.json'), 'utf8'));
const plan = await pinRuntimePlan(compileRecipe(recipe, { ...ids, title: 'MAKE ROOM FOR IDEAS', duration: 3 }, project.id));
const h = openHarness();
try {
  const run = h.enqueue(plan, 'editable-scene'), adapters = createRuntimeAdapters();
  await h.step(run, adapters); await h.step(run, adapters);
  const job = h.jobs(run)[0]; assert.equal(job.state, 'succeeded', job.error ?? ''); assert.equal(job.attempts, 1);
  assert.equal(await loadProjectTimeline(project.id), null);
  const accepted = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'scripts/harness.ts', 'attach', project.id, run, job.id, '0'], { env: process.env, encoding: 'utf8' }));
  assert.equal(accepted.ok, true);
  const before = (await loadProjectTimeline(project.id))!;
  const clips = before.document.tracks.flatMap(track => track.clips);
  assert.equal(clips.length, 5); assert.deepEqual(clips.map(clip => clip.sourceType).sort(), ['audio', 'audio', 'caption', 'image', 'video']);
  assert.equal(before.document.tracks.filter(track => track.kind === 'audio' && track.clips.length).length, 2);
  const caption = clips.find(clip => clip.sourceType === 'caption')!;
  const first = await renderProjectTimelineToAsset({ projectId: project.id, document: before.document, timelineRevision: before.version });
  await copyFile(first.localPath, join(evidence, 'before.mp4'));
  const edited = await persistViralHitCommand({ projectId: project.id, origin: 'ui', commandId: 'change-title', expectedRevision: before.version, command: { type: 'editor.apply', operations: [{ type: 'upsert_caption', clipId: caption.id, text: 'YOUR NEXT CHAPTER', startTime: 0, duration: 3 }] } });
  assert.equal(edited.ok, true);
  const after = (await loadProjectTimeline(project.id))!;
  for (const clip of after.document.tracks.flatMap(track => track.clips).filter(clip => clip.sourceType !== 'caption')) assert.deepEqual(clip, clips.find(original => original.id === clip.id));
  const rendered = await renderProjectTimelineToAsset({ projectId: project.id, document: after.document, timelineRevision: after.version });
  const final = join(evidence, 'after.mp4'); await copyFile(rendered.localPath, final);
  const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', final], { encoding: 'utf8' }));
  const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video');
  assert.equal(video.width, 1920); assert.equal(video.height, 1080); assert.equal(Number(video.nb_read_frames), 90);
  assert.ok(probe.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio'));
  execFileSync(ffmpeg, ['-v', 'error', '-i', final, '-f', 'null', '-']);
  const pcm = execFileSync(ffmpeg, ['-v', 'error', '-ss', '0.5', '-i', final, '-t', '1', '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 2 * 1024 * 1024 });
  const spectrum: Record<number, number> = {};
  for (const hz of [330, 660, 880]) {
    let real = 0, imaginary = 0;
    for (let i = 0; i < pcm.length / 4; i++) { const sample = pcm.readFloatLE(i * 4); real += sample * Math.cos(2 * Math.PI * hz * i / 48000); imaginary += sample * Math.sin(2 * Math.PI * hz * i / 48000); }
    spectrum[hz] = Math.hypot(real, imaginary) / (pcm.length / 4); if (hz === 660) assert.ok(spectrum[hz] < 0.0002, 'Muted source video audio must not enter the mix');
    else assert.ok(spectrum[hz] > 0.001, `Missing ${hz} Hz source`);
  }
  const crops = [];
  for (const name of ['before', 'after']) {
    const file = join(evidence, `${name}.mp4`);
    execFileSync(ffmpeg, ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', join(evidence, `${name}.png`)]);
    crops.push(execFileSync(ffmpeg, ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'crop=1920:360:0:720,scale=480:90', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']));
  }
  let changed = 0; for (let i = 0; i < crops[0].length; i++) if (Math.abs(crops[0][i] - crops[1][i]) > 20) changed++;
  assert.ok(changed > 500, 'Changing the later caption track must change exported text pixels');
  for (const [name, id] of Object.entries(ids)) { const asset = (await getProjectAssetById({ projectId: project.id, assetId: id }))!; assert.equal(hash(await readFile(resolveLocalProjectAssetPath({ objectKey: asset.objectKey }))), originals[name]); }
  const result = { projectId: project.id, runId: run, jobId: job.id, beforeRevision: before.version, afterRevision: after.version, clipCount: clips.length, spectrum, changedCaptionBytes: changed, final, sha256: hash(await readFile(final)), probe };
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ evidence, projectId: project.id, clipCount: clips.length, spectrum, changedCaptionBytes: changed }));
} finally { h.close(); }
