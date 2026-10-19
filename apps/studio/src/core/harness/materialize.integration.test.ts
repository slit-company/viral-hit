import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, test } from 'node:test';
import { createDemoMedia } from '../../../scripts/demo-media.mjs';
import { assertPublicAddress, mediaUrl, downloadMedia } from './download-media';
import { probeMedia } from './probe-media';
import { DurableHarness, type Adapter } from './durable';

const directory = await mkdtemp(join(tmpdir(), 'viral-hit-materialize-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { createProject } = await import('../projects/projects');
const { getProjectAssetById, listProjectAssets } = await import('../workspace-lib/assets/user-assets');
const { createMaterializeAdapter, fileHash, stableAssetId } = await import('./materialize');
const { attachMaterializedJob } = await import('./attach-asset');
const { loadProjectTimeline } = await import('../editor/timeline-state');
const { persistViralHitCommand } = await import('../commands/persist');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');

test('media network policy rejects private, mapped, reserved and non-HTTPS targets', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '192.0.2.1', '::1', '::ffff:127.0.0.1', 'fe80::1', '2001:db8::1', 'ff02::1']) assert.throws(() => assertPublicAddress(address));
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.doesNotThrow(() => assertPublicAddress(address));
  for (const url of ['file:///etc/passwd', 'http://example.org/a', 'https://user:password@example.org/a', 'https://example.org:8443/a', 'https://[::ffff:127.0.0.1]/a']) assert.throws(() => mediaUrl(url));
  const path = join(directory, 'must-not-download');
  await assert.rejects(downloadMedia('https://localhost/a', path, AbortSignal.timeout(2000)), /public network/);
  await assert.rejects(readFile(path), /ENOENT/);
  await writeFile(path, 'existing file');
  await assert.rejects(downloadMedia('http://localhost/a', path, AbortSignal.timeout(2000)));
  assert.equal(await readFile(path, 'utf8'), 'existing file');
});

test('actual media probe distinguishes raster images, video, audio and invalid payloads', async () => {
  const signal = AbortSignal.timeout(20000);
  const image = await probeMedia('public/logo.png', 'image', signal);
  assert.equal(image.mimeType, 'image/png'); assert.ok(image.width! > 0);
  const video = join(directory, 'fixture.mp4'); createDemoMedia(video);
  const info = await probeMedia(video, 'video', signal);
  assert.equal(info.kind, 'video'); assert.equal(info.durationMs, 3000); assert.equal(info.hasAudio, true);
  await assert.rejects(probeMedia(video, 'image', signal), /raster/);
  const audio = join(directory, 'audio.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', audio]);
  assert.equal((await probeMedia(audio, 'audio', signal)).durationMs, 1000);
  const bad = join(directory, 'bad.png'); await writeFile(bad, '<html>not media</html>');
  await assert.rejects(probeMedia(bad, 'image', signal));
});

test('materialization is replay-safe and records durable project ownership plus file integrity', async () => {
  const project = await createProject({ name: 'Replay asset fixture' }); let downloads = 0;
  const adapter = createMaterializeAdapter({ download: async (_url, destination) => { downloads++; await copyFile('public/logo.png', destination); }, probe: probeMedia });
  const input = { url: 'https://example.org/generated.png', kind: 'image', label: 'Fixture image' };
  const context = { key: 'same-key', dependencies: {}, projectId: project.id, runId: 'fixture-run', jobId: 'fixture-job', signal: AbortSignal.timeout(20000) };
  const one = await adapter.submit(input, context), two = await adapter.submit(input, context);
  assert.equal(one.id, two.id); assert.equal(downloads, 1);
  const result = await adapter.poll(one.id, input, context.signal);
  assert.equal(result.state, 'succeeded');
  const assets = await listProjectAssets({ projectId: project.id }); assert.equal(assets.length, 1);
  const asset = await getProjectAssetById({ projectId: project.id, assetId: stableAssetId(project.id, 'same-key') });
  assert.equal(asset!.source, 'provider'); assert.match(asset!.publicUrl, /^\/api\/app\/projects\//);
  const file = resolveLocalProjectAssetPath({ objectKey: asset!.objectKey }); assert.equal(await fileHash(file), asset!.sha256);
  await writeFile(file, 'corrupted');
  assert.equal((await adapter.poll(one.id, input, context.signal)).state, 'failed');
  assert.equal(downloads, 1);
});

test('paid generation → local asset → revision-checked timeline attachment survives a worker restart', async () => {
  const project = await createProject({ name: 'End to end fixture, not live generation' });
  const database = join(directory, 'harness.db'); let h = new DurableHarness(database), paidSubmits = 0, downloads = 0;
  const generation: Adapter = { recovery: 'replay', async submit() { paidSubmits++; return { id: 'fixture-provider' }; }, async poll() { return { state: 'succeeded', output: { data: { result: { sample: 'https://example.org/image.png' } } } }; } };
  const assetAdapter = createMaterializeAdapter({ download: async (_url, destination) => { downloads++; await copyFile('public/logo.png', destination); }, probe: probeMedia });
  const adapters = { 'comfy.router': generation, 'asset.materialize': assetAdapter };
  const run = h.enqueue({ projectId: project.id, nodes: [
    { id: 'frame', operation: 'comfy.router', version: 'fixture', input: {} },
    { id: 'asset', operation: 'asset.materialize', version: '1', input: { url: '', kind: 'image' }, dependsOn: ['frame'], bindings: [{ node: 'frame', pointer: '/data/result/sample', target: '/url' }] },
  ] }, 'request');
  await h.step(run, adapters); await h.step(run, adapters); await h.step(run, adapters);
  h.close(); h = new DurableHarness(database); await h.step(run, adapters);
  const imported = h.jobs(run)[1]; assert.equal(imported.state, 'succeeded'); assert.equal(paidSubmits, 1); assert.equal(downloads, 1);
  // Create an intervening user edit, then refuse a stale attachment.
  await persistViralHitCommand({ projectId: project.id, origin: 'ui', commandId: 'caption-before-attach', expectedRevision: 0, command: { type: 'editor.apply', operations: [{ type: 'upsert_caption', clipId: 'user-caption', text: 'Keep my edit', startTime: 0, duration: 3 }] } });
  const conflict = await attachMaterializedJob(h, project.id, run, imported.id, 0);
  assert.equal(conflict.ok, false); if (!conflict.ok) assert.equal(conflict.code, 'REVISION_CONFLICT');
  const current = await loadProjectTimeline(project.id);
  const first = await attachMaterializedJob(h, project.id, run, imported.id, current!.version);
  assert.equal(first.ok, true);
  const repeat = await attachMaterializedJob(h, project.id, run, imported.id, current!.version);
  assert.deepEqual(repeat, first);
  const timeline = (await loadProjectTimeline(project.id))!.document;
  assert.equal(timeline.tracks.flatMap(t => t.clips).filter(c => c.id === `harness-${imported.id}`).length, 1);
  assert.ok(timeline.tracks.flatMap(t => t.clips).some(c => c.text === 'Keep my edit'));
  const other = await createProject({ name: 'Other project' });
  await assert.rejects(attachMaterializedJob(h, other.id, run, imported.id, 0), /not found/); h.close();
});

test('process interruption after immutable file publication recovers without a second download', async () => {
  const project = await createProject({ name: 'Publication boundary recovery' });
  let downloads = 0, probes = 0;
  const adapter = createMaterializeAdapter({
    download: async (_url, destination) => { downloads++; await copyFile('public/logo.png', destination); },
    probe: async (file, kind, signal) => { if (++probes === 2) throw new Error('Injected crash after publication'); return probeMedia(file, kind, signal); },
  });
  const input = { url: 'https://example.org/result.png', kind: 'image' };
  const context = { key: 'recover-file', dependencies: {}, projectId: project.id, runId: 'recovery', jobId: 'local-job', signal: AbortSignal.timeout(10000) };
  await assert.rejects(adapter.submit(input, context), /Injected crash/);
  const recovered = await adapter.submit(input, context);
  assert.equal((await adapter.poll(recovered.id, input, context.signal)).state, 'succeeded');
  assert.equal(downloads, 1); assert.equal((await listProjectAssets({ projectId: project.id })).length, 1);
});
