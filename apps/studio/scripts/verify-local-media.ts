// Opt-in live integration: requires the separate extension install and real FFmpeg.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Adapter } from '../src/core/harness/durable';

const studio = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(studio);
const extension = resolve(studio, '../../extensions/local-media');
const destination = process.argv[2];
if (!destination || !isAbsolute(destination)) throw new Error('Usage: pnpm exec tsx scripts/verify-local-media.ts /absolute/evidence-directory');
if (!process.env.VIRAL_HIT_FFMPEG || !process.env.VIRAL_HIT_FFPROBE) throw new Error('Set VIRAL_HIT_FFMPEG and VIRAL_HIT_FFPROBE to real executables');
await mkdir(destination, { recursive: true });
const evidence = await mkdtemp(join(destination, 'run-'));
process.env.VIRAL_HIT_DATA_DIR = join(evidence, 'data');
process.env.VIRAL_HIT_ADAPTERS_DIR = join(extension, 'dist/adapters');
process.env.VIRAL_HIT_LOCAL_MEDIA_DIR = extension;
await mkdir(process.env.VIRAL_HIT_DATA_DIR, { recursive: true });
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { cwd: studio, env: process.env, stdio: 'pipe' });
assert.ok((await readFile(join(process.env.VIRAL_HIT_DATA_DIR, 'local.db'))).length > 0, 'schema setup must create the isolated database');
const { openHarness } = await import('../src/core/harness/store');
const { readExternalCatalog, pinExternalAdapters } = await import('../src/core/harness/external-catalog');
const { createExternalAdapter } = await import('../src/core/harness/external-adapters');
const { createMaterializeAdapter } = await import('../src/core/harness/materialize');
const { compileRecipe } = await import('../src/core/harness/recipes');
const { createProject } = await import('../src/core/projects/projects');
const { getProjectAssetById } = await import('../src/core/workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../src/core/projects/local-project-assets');
const { attachMaterializedJob } = await import('../src/core/harness/attach-asset');
const { loadProjectTimeline } = await import('../src/core/editor/timeline-state');
const { renderProjectTimelineToAsset } = await import('../src/core/editor/render-project-timeline');
const entries = readExternalCatalog(process.env.VIRAL_HIT_ADAPTERS_DIR);
const adapters: Record<string, Adapter> = { ...Object.fromEntries(entries.map(entry => [entry.descriptor.operation, createExternalAdapter(entry)])), 'asset.materialize': createMaterializeAdapter() };
const project = await createProject({ name: 'Local engines — real render verification' });
const h = openHarness();
const runs = [];

function observeChildren() {
  let peakKiB = 0, peakProcesses = 0, samples = 0;
  const sample = () => {
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,comm='], { encoding: 'utf8' }).trim().split('\n').map(line => {
      const [pid, parent, rss, ...command] = line.trim().split(/\s+/);
      return { pid: Number(pid), parent: Number(parent), rss: Number(rss), command: command.join(' ') };
    });
    const pids = new Set([process.pid]);
    const byParent = new Map<number, number[]>();
    for (const { pid, parent } of rows) byParent.set(parent, [...(byParent.get(parent) ?? []), pid]);
    for (const parent of pids) for (const pid of byParent.get(parent) ?? []) pids.add(pid);
    // Exclude the short-lived ps sampler itself and this test's Node process.
    const children = rows.filter(row => pids.has(row.pid) && row.pid !== process.pid && !/(?:^|\/)ps$/.test(row.command));
    peakKiB = Math.max(peakKiB, children.reduce((sum, row) => sum + row.rss, 0));
    peakProcesses = Math.max(peakProcesses, children.length); samples++;
  };
  const timer = setInterval(sample, 100);
  return () => { clearInterval(timer); return { sampledDescendantPeakMiB: peakKiB / 1024, peakProcesses, samples, intervalMs: 100 }; };
}
function probe(file: string) {
  return JSON.parse(execFileSync(process.env.VIRAL_HIT_FFPROBE!, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }));
}
try {
  for (const [name, kind, suffix] of [['music2-render', 'audio', 'wav'], ['vid2-render', 'video', 'mp4']]) {
    const recipe = JSON.parse(await readFile(join(extension, 'recipes', `${name}.json`), 'utf8'));
    const plan = pinExternalAdapters(compileRecipe(recipe, {}, project.id), entries);
    const run = h.enqueue(plan, `live-${name}`), start = performance.now(), finishObservation = observeChildren();
    for (let i = 0; i < 4; i++) await h.step(run, adapters);
    const elapsedMs = performance.now() - start, memory = finishObservation();
    const jobs = h.jobs(run);
    assert.deepEqual(jobs.map(job => job.state), ['succeeded', 'succeeded'], JSON.stringify(jobs.map(job => ({ state: job.state, error: job.error }))));
    const materialized = JSON.parse(jobs[1].output_json!);
    const asset = await getProjectAssetById({ projectId: project.id, assetId: materialized.assetId }); assert.ok(asset);
    assert.equal(asset.type, kind);
    const path = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
    const file = join(evidence, `${name}.${suffix}`); await copyFile(path, file);
    const media = probe(file), stream = media.streams.find((s: { codec_type: string }) => s.codec_type === kind); assert.ok(stream);
    if (kind === 'audio') { assert.equal(stream.sample_rate, '48000'); assert.equal(Number(stream.duration), 4); }
    else { assert.equal(stream.width, 640); assert.equal(stream.height, 360); assert.equal(Number(stream.nb_read_frames), 120); }
    const state = await loadProjectTimeline(project.id);
    const attached = await attachMaterializedJob(h, project.id, run, jobs[1].id, state?.version ?? 0);
    assert.equal(attached.ok, true, JSON.stringify(attached));
    const bytes = await readFile(file);
    runs.push({ name, runId: run, elapsedMs, ...memory, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), attempts: jobs.map(job => job.attempts), media });
    console.log(`${name}: rendered, materialized and attached in ${Math.round(elapsedMs)} ms`);
    // This goes through the data-URL module loader and the actual binary receipt store.
    const recovered = await adapters[`ext.${name}`].poll(jobs[0].provider_id!, JSON.parse(jobs[0].execution_input_json!), AbortSignal.timeout(1000), { projectId: project.id, runId: run, jobId: jobs[0].id });
    assert.equal(recovered.state, 'succeeded');
  }
  const timeline = await loadProjectTimeline(project.id); assert.ok(timeline);
  const exported = await renderProjectTimelineToAsset({ projectId: project.id, document: timeline.document, timelineRevision: timeline.version });
  await copyFile(exported.localPath, join(evidence, 'mixed-timeline.mp4'));
  const final = probe(exported.localPath);
  assert.ok(final.streams.some((s: { codec_name: string }) => s.codec_name === 'h264'));
  assert.ok(final.streams.some((s: { codec_name: string }) => s.codec_name === 'aac'));
  execFileSync(process.env.VIRAL_HIT_FFMPEG!, ['-v', 'error', '-i', exported.localPath, '-f', 'null', '-'], { stdio: 'pipe' });
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ projectId: project.id, dataDirectory: process.env.VIRAL_HIT_DATA_DIR, runs, timeline: { revision: timeline.version, tracks: timeline.document.tracks.map(track => ({ kind: track.kind, clips: track.clips.length })) }, exported: final }, null, 2));
  console.log(`Evidence: ${evidence}`);
} finally { h.close(); }
