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

// Real encoded media with a fixture SDK transport: proves byte retention and editing, not TTS quality.
test('binary Router audio survives receipt/ledger interruption and reaches the audio timeline without resubmission', async () => {
  const { createComfyRouterAdapter } = await import('./comfy-router');
  const { readBinaryReceipt } = await import('./binary-receipts');
  const { compileRecipe } = await import('./recipes');
  const project = await createProject({ name: 'Binary audio recovery fixture' });
  const audioFile = join(directory, 'speech-fixture.mp3');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.5', '-c:a', 'libmp3lame', audioFile]);
  const bytes = await readFile(audioFile); let submits = 0, gets = 0, now = 10_000;
  const sdk = {
    async submit() { submits++; return { requestId: 'binary-provider-job' }; },
    handle() { return { async status() { return { completed: true }; }, async get() { gets++; return { kind: 'binary', data: bytes, requestId: 'binary-provider-job', contentType: 'audio/mpeg', creditsUsed: '0.004', servingProvider: 'fixture', droppedParams: [] }; } }; },
  } as unknown as Parameters<typeof createComfyRouterAdapter>[0];
  const router = createComfyRouterAdapter(sdk), media = createMaterializeAdapter();
  const recipe = JSON.parse(await readFile('../../recipes/spoken-line.json', 'utf8'));
  const plan = compileRecipe(recipe, { text: 'A fixture does not prove speech quality.', voice: 'test-voice' }, project.id);
  const database = join(directory, 'audio-recovery.db'); let h = new DurableHarness(database, () => now);
  const run = h.enqueue(plan, 'binary-request');
  const interrupted: Adapter = { ...router, async poll(...args) { await router.poll(...args); throw new Error('Injected process interruption after receipt publication'); } };
  await h.step(run, { 'comfy.router': router });
  await h.step(run, { 'comfy.router': interrupted });
  assert.equal(h.jobs(run)[0].state, 'running');
  assert.ok(await readBinaryReceipt({ projectId: project.id, jobId: h.jobs(run)[0].id }, AbortSignal.timeout(5000)));
  h.close(); now += 6000; h = new DurableHarness(database, () => now);
  for (let i = 0; i < 3; i++) await h.step(run, { 'comfy.router': router, 'asset.materialize': media });
  const jobs = h.jobs(run); assert.deepEqual(jobs.map(j => j.state), ['succeeded', 'succeeded']);
  assert.equal(submits, 1); assert.equal(gets, 1);
  const receipt = JSON.parse(jobs[0].output_json!);
  assert.equal(receipt.creditsUsed, '0.004'); assert.equal(receipt.servingProvider, 'fixture');
  assert.equal(receipt.data, undefined); assert.equal(JSON.stringify(receipt).includes(bytes.toString('base64')), false);
  const output = JSON.parse(jobs[1].output_json!); assert.equal(output.kind, 'audio'); assert.equal(output.sha256, await fileHash(audioFile));
  assert.equal((await attachMaterializedJob(h, project.id, run, jobs[1].id, 0)).ok, true);
  const timeline = (await loadProjectTimeline(project.id))!.document;
  assert.ok(timeline.tracks.some(track => track.kind === 'audio' && track.clips.some(clip => clip.assetId === output.assetId)));
  // A source receipt is scoped to its project and hash, not a caller-supplied filesystem path.
  const other = await createProject({ name: 'Other binary project' });
  await assert.rejects(media.submit({ kind: 'audio', receipt: receipt.binaryReceipt }, { projectId: other.id, runId: run, jobId: jobs[1].id, key: 'other', dependencies: {}, signal: AbortSignal.timeout(5000) }), /unavailable/);
  const saved = await readBinaryReceipt({ projectId: project.id, jobId: jobs[0].id }, AbortSignal.timeout(5000));
  await writeFile(saved!.file, 'tampered');
  assert.equal((await router.poll('binary-provider-job', plan.nodes[0].input, AbortSignal.timeout(5000), { projectId: project.id, runId: run, jobId: jobs[0].id })).state, 'failed');
  assert.equal(gets, 1); assert.equal(submits, 1); h.close();
});

test('binary receipt publication preserves original bytes on replay conflict and never trusts the content type', async () => {
  const { randomUUID } = await import('node:crypto');
  const { saveBinaryReceipt, readBinaryReceipt } = await import('./binary-receipts');
  const project = await createProject({ name: 'Untrusted binary fixture' });
  const context = { projectId: project.id, jobId: randomUUID() }, signal = AbortSignal.timeout(10000);
  const details = { provider: 'comfy-router' as const, model: 'fixture/audio', providerJobId: 'r', requestId: 'r', contentType: 'audio/mpeg', creditsUsed: null, servingProvider: null, droppedParams: null };
  const bytes = Buffer.from('<html>Not audio despite the declared type</html>');
  const receipt = await saveBinaryReceipt(context, details, bytes, signal);
  assert.deepEqual(await saveBinaryReceipt(context, details, bytes, signal), receipt);
  await assert.rejects(saveBinaryReceipt(context, details, Buffer.from('different'), signal), /differs/);
  const saved = await readBinaryReceipt(context, signal); assert.deepEqual(await readFile(saved!.file), bytes);
  const adapter = createMaterializeAdapter();
  await assert.rejects(adapter.submit({ kind: 'audio', receipt: { jobId: context.jobId, sha256: receipt.sha256 } }, { ...context, runId: 'fixture', key: 'html', dependencies: {}, signal }));
  assert.equal((await listProjectAssets({ projectId: project.id })).length, 0);
  await assert.rejects(saveBinaryReceipt({ ...context, jobId: randomUUID() }, details, new Uint8Array(), signal), /empty/);
});

test('video recipe consumes the native Kling task-list response and attaches the real MP4 duration', async () => {
  const { createComfyRouterAdapter } = await import('./comfy-router');
  const { compileRecipe } = await import('./recipes');
  const project = await createProject({ name: 'Video recipe fixture' });
  const recipe = JSON.parse(await readFile('../../recipes/open-motion.json', 'utf8'));
  const plan = compileRecipe(recipe, { prompt: 'Original test animation', duration: 3, 'aspect-ratio': '16:9', resolution: '1080p' }, project.id);
  let submits = 0;
  const router = createComfyRouterAdapter({ async submit(model: string, body: unknown) {
    assert.equal(model, 'kling/kling-3.0-turbo');
    assert.deepEqual(body, { prompt: 'Original test animation', settings: { aspect_ratio: '16:9', duration: 3, resolution: '1080p' } });
    submits++; return { requestId: 'video-job' };
  }, handle() { return { async status() { return { completed: true }; }, async get() { return { kind: 'json', requestId: 'video-job', data: { code: 0, data: [{ id: 'native-task', status: 'succeeded', outputs: [{ type: 'video', url: 'https://example.org/fixture.mp4', duration: '3' }] }] } }; } }; } } as unknown as Parameters<typeof createComfyRouterAdapter>[0]);
  const video = join(directory, 'video-recipe.mp4'); createDemoMedia(video);
  const media = createMaterializeAdapter({ download: async (url, destination) => { assert.equal(url, 'https://example.org/fixture.mp4'); await copyFile(video, destination); }, probe: probeMedia });
  const h = new DurableHarness(':memory:'); const run = h.enqueue(plan, 'video-fixture');
  try {
    for (let i = 0; i < 4; i++) await h.step(run, { 'comfy.router': router, 'asset.materialize': media });
    const jobs = h.jobs(run); assert.deepEqual(jobs.map(j => j.state), ['succeeded', 'succeeded']); assert.equal(submits, 1);
    const output = JSON.parse(jobs[1].output_json!); assert.equal(output.durationMs, 3000); assert.equal(output.kind, 'video');
    assert.equal((await attachMaterializedJob(h, project.id, run, jobs[1].id, 0)).ok, true);
    const clip = (await loadProjectTimeline(project.id))!.document.tracks.flatMap(t => t.clips).find(c => c.assetId === output.assetId)!;
    assert.equal(clip.duration, 3);
  } finally { h.close(); }
});
