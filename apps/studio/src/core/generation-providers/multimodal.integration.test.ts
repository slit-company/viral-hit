import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const directory = await mkdtemp(join(tmpdir(), 'vh-multimodal-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
process.env.VIRAL_HIT_FFPROBE ||= 'ffprobe';
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(() => rm(directory, { recursive: true, force: true }));
await cp('../../examples/providers/media-batch-inspector', join(directory, 'providers/media-batch-inspector'), { recursive: true });
const { installGenerationProviders } = await import('./installed/install.server');
assert.equal(installGenerationProviders(join(directory, 'providers')).problems.length, 0);
const { createProject } = await import('../projects/projects');
const { persistLocalProjectAsset } = await import('../projects/local-project-assets');
const { recordUserAsset, linkProjectAsset } = await import('../workspace-lib/assets/user-assets');
const { submitAssetFirstGeneration, preflightAssetFirstGeneration } = await import('./submit');
const { listProjectGenerations } = await import('../effects/project-generations');
const { getGenerationById, updateGenerationById } = await import('../effects/record-generation');
const { listAnalysisRecords } = await import('./analysis-records.server');
const { listGenerationModelDescriptors } = await import('./model-catalog');

async function fixture() {
  const project = await createProject({ name: 'Mixed original media' });
  const assets = [];
  for (const [kind, extension, mimeType, args] of [
    ['image', 'png', 'image/png', ['-f', 'lavfi', '-i', 'color=c=blue:s=80x60', '-frames:v', '1']],
    ['video', 'mp4', 'video/mp4', ['-f', 'lavfi', '-i', 'color=c=orange:s=180x320:r=12:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
    ['audio', 'wav', 'audio/wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '24000', '-c:a', 'pcm_s16le']],
  ] as const) {
    const path = join(directory, `${project.id}.${extension}`);
    execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', ...args, path]);
    const saved = await persistLocalProjectAsset({ projectId: project.id, filename: `source.${extension}`, mimeType, bytes: await readFile(path) });
    await recordUserAsset({ id: saved.assetId, type: kind, source: 'upload', bucket: 'local-project-assets', storageProvider: 'local', objectKey: saved.objectKey, publicUrl: saved.publicUrl, sha256: saved.sha256, sizeBytes: saved.sizeBytes, filename: saved.filename, mimeType });
    await linkProjectAsset({ projectId: project.id, assetId: saved.assetId, role: 'upload' });
    assets.push({ ...saved, kind });
  }
  return { project, assets, generation: { version: 2, projectId: project.id, mode: 'analysis', modelId: 'media-batch-review', prompt: 'Inventory these original sources', references: assets.map(asset => ({ assetId: asset.assetId, role: 'source' })), parameters: {} } };
}

test('mixed, image-only and audio-only analysis measures real local originals and retains all input history', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw Error('No network is needed for local batch inspection'); });
  const { generation, assets } = await fixture();
  assert.deepEqual(listGenerationModelDescriptors().find(model => model.id === generation.modelId)?.referenceSchema, { image: { min: 0, max: 8 }, video: { min: 0, max: 4 }, audio: { min: 0, max: 4 } });
  for (const selection of [assets, [assets[0]], [assets[2]]]) {
    const request = { ...generation, references: selection.map(asset => ({ assetId: asset.assetId, role: 'reference' })) };
    assert.equal((await preflightAssetFirstGeneration(request)).expectedUploadCount, 0);
    const result = await submitAssetFirstGeneration({ generation: request, origin: 'mcp' });
    assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
    const history = (await listProjectGenerations(generation.projectId)).find(item => item.id === result.body.wmTaskId)!;
    assert.match(history.resultText!, /measured file metadata/);
    for (const asset of selection) assert.ok(history.resultText!.includes(asset.sha256));
    assert.deepEqual(history.referenceImages, selection.filter(asset => asset.kind === 'image').map(asset => asset.publicUrl));
    assert.deepEqual(history.referenceVideos, selection.filter(asset => asset.kind === 'video').map(asset => asset.publicUrl));
    assert.deepEqual(history.referenceAudios, selection.filter(asset => asset.kind === 'audio').map(asset => asset.publicUrl));
    if (selection.length === 3) {
      assert.match(history.resultText!, /80 × 60/);
      assert.match(history.resultText!, /180 × 320/);
      assert.match(history.resultText!, /pcm_s16le; 24000 Hz; 1 channel/);
    }
  }
});

test('invalid roles, foreign media and empty batches fail before generation; batch reports cannot become single-source storyboards', async () => {
  const { generation, assets } = await fixture();
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, references: [] }), /at least one/);
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, references: [{ assetId: assets[0].assetId, role: 'audio_track' }] }), /not an audio/);
  const foreign = await createProject({ name: 'Foreign media' });
  await assert.rejects(preflightAssetFirstGeneration({ ...generation, projectId: foreign.id }), /local project media/);
  assert.deepEqual(await listProjectGenerations(generation.projectId), []);
  const result = await submitAssetFirstGeneration({ generation, origin: 'cli' });
  const id = String(result.body.wmTaskId);
  const record = await getGenerationById({ id });
  await updateGenerationById({ id, status: 'succeeded', output: { ...(record!.output as object), analysis_report: { schemaVersion: 1, summary: 'Ambiguous batch', observations: [{ id: 'batch', start: 0, end: 1, description: 'No single timeline' }] } } });
  assert.deepEqual((await listAnalysisRecords(generation.projectId)).records, []);
});

test('multiple real videos retain declared order without a misleading singular timeline alias', async () => {
  const { generation, assets } = await fixture();
  const path = join(directory, 'second-video.mp4');
  execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=12:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path]);
  const second = await persistLocalProjectAsset({ projectId: generation.projectId, filename: 'second.mp4', mimeType: 'video/mp4', bytes: await readFile(path) });
  await recordUserAsset({ id: second.assetId, type: 'video', source: 'upload', bucket: 'local-project-assets', storageProvider: 'local', objectKey: second.objectKey, publicUrl: second.publicUrl, sha256: second.sha256, sizeBytes: second.sizeBytes, filename: second.filename, mimeType: 'video/mp4' });
  await linkProjectAsset({ projectId: generation.projectId, assetId: second.assetId, role: 'upload' });
  const result = await submitAssetFirstGeneration({ generation: { ...generation, references: [{ assetId: second.assetId, role: 'source' }, { assetId: assets[1].assetId, role: 'source' }] }, origin: 'ui' });
  assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
  const [history] = await listProjectGenerations(generation.projectId);
  assert.deepEqual(history.referenceVideos, [second.publicUrl, assets[1].publicUrl]);
  assert.match(history.resultText!, /1\. video: second\.mp4[\s\S]*320 × 180[\s\S]*2\. video: source\.mp4[\s\S]*180 × 320/);
  const record = await getGenerationById({ id: history.id });
  assert.equal((record!.input as Record<string, unknown>).video_url, undefined);
});
