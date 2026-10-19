import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const directory = await mkdtemp(join(tmpdir(), 'vh-reference-test-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { createProject, deleteProjects } = await import('../projects/projects');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { acquireVideoReference, importLocalVideoReference, importYouTubeVideo } = await import('./intake.server');
const { referenceFile, referenceIdentity } = await import('./reference-assets.server');
const { probeMedia } = await import('../harness/probe-media');
const video = join(directory, 'source.mp4');
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=128x72:d=2:r=10',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', video]);
const signal = () => AbortSignal.timeout(30000);
const key = createHash('sha256').update('fixture-account/thread/item').digest('hex');

test('real video and five decoded samples become replayable project references without signed URLs', async () => {
  const project = await createProject({ name: 'Reference intake' });
  let requests = 0;
  const acquire = async (file: string) => { requests++; await copyFile(video, file); };
  const receipt = await acquireVideoReference({ projectId: project.id, source: 'instagram-direct', sourceKey: key, acquire, signal: signal() });
  assert.equal(receipt.original.durationMs, 2000); assert.equal(receipt.original.hasAudio, true);
  assert.equal(receipt.samples.length, 5); assert.deepEqual(receipt.samples.map(s => s.atMs), [0, 500, 1000, 1500, 1900]);
  for (const sample of receipt.samples) {
    const row = await getProjectAssetById({ projectId: project.id, assetId: sample.assetId }); assert.ok(row);
    const info = await probeMedia(referenceFile(project.id, sample.assetId).path, 'image', signal());
    assert.equal(info.width, 128); assert.equal(info.height, 72);
    assert.ok(!JSON.stringify(row).includes('sig='));
  }
  const replay = await acquireVideoReference({ projectId: project.id, source: 'instagram-direct', sourceKey: key,
    acquire: async () => { throw new Error('expired source must not be fetched again'); }, signal: signal() });
  assert.deepEqual(replay, receipt); assert.equal(requests, 1);
  const foreign = await createProject({ name: 'Another project' });
  assert.equal(await getProjectAssetById({ projectId: foreign.id, assetId: receipt.original.assetId }), null);
  const isolated = await acquireVideoReference({ projectId: foreign.id, source: 'instagram-direct', sourceKey: key, acquire, signal: signal() });
  assert.notEqual(isolated.original.assetId, receipt.original.assetId); assert.equal(requests, 2);
});

test('corrupted retained originals fail without reacquisition or substituting other bytes', async () => {
  const project = await createProject({ name: 'Corruption boundary' });
  const receipt = await importLocalVideoReference(project.id, video, signal());
  const file = referenceFile(project.id, receipt.original.assetId).path, bytes = await readFile(file);
  bytes[0] ^= 1; await writeFile(file, bytes);
  await assert.rejects(importLocalVideoReference(project.id, video, signal()), /integrity mismatch/);
});

test('an interrupted registration recovers original bytes without repeating acquisition', async () => {
  const project = await createProject({ name: 'Interrupted registration' });
  const id = referenceIdentity(project.id, 'instagram-direct', key, 'original');
  const file = referenceFile(project.id, id).path;
  await mkdir(dirname(file), { recursive: true }); await copyFile(video, file);
  const receipt = await acquireVideoReference({ projectId: project.id, source: 'instagram-direct', sourceKey: key,
    acquire: async () => { throw new Error('must reuse retained file'); }, signal: signal() });
  assert.equal(receipt.original.assetId, id); assert.equal(receipt.samples.length, 5);
  await rm(file);
  await assert.rejects(acquireVideoReference({ projectId: project.id, source: 'instagram-direct', sourceKey: key,
    acquire: async () => { throw new Error('must not replace lost original'); }, signal: signal() }));
});

test('invalid media and deleted projects cannot produce references or invoke an external engine', async () => {
  const project = await createProject({ name: 'Input validation' });
  await assert.rejects(acquireVideoReference({ projectId: project.id, source: 'local', sourceKey: key,
    acquire: file => writeFile(file, 'not a video'), signal: signal() }));
  await deleteProjects({ projectIds: [project.id] });
  let invoked = false;
  await assert.rejects(acquireVideoReference({ projectId: project.id, source: 'local', sourceKey: key,
    acquire: async () => { invoked = true; }, signal: signal() }), /Project not found/);
  assert.equal(invoked, false);
});

test('YouTube intake is optional and validates selections before execution', async () => {
  const project = await createProject({ name: 'Optional engine' });
  assert.throws(() => importYouTubeVideo(project.id, 'not an id', signal()), /Invalid YouTube/);
  const previous = process.env.VIRAL_HIT_YOUTUBE_ENGINE;
  delete process.env.VIRAL_HIT_YOUTUBE_ENGINE;
  try { await assert.rejects(importYouTubeVideo(project.id, 'u_yIGGhubZs', signal()), /Install and configure/); }
  finally { if (previous) process.env.VIRAL_HIT_YOUTUBE_ENGINE = previous; }
});
