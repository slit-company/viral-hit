import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { EffectRecord } from '../adapters/base-adapter';

const directory = await mkdtemp(join(tmpdir(), 'vh-local-provider-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
process.env.VIRAL_HIT_FFPROBE ||= 'ffprobe';
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { stdio: 'pipe', env: process.env });
after(() => rm(directory, { recursive: true, force: true }));
const providers = join(directory, 'providers');
await cp('../../examples/providers/media-inspector', join(providers, 'media-inspector'), { recursive: true });
const echoFolder = join(providers, 'local-image');
await mkdir(echoFolder, { recursive: true });
const echoManifest = {
  schemaVersion: 1, kind: 'viral-hit-provider', id: 'local-image', label: 'Local image',
  referenceDelivery: 'project-media', scope: 'general',
  models: [{ id: 'local-image-copy', name: 'Byte copy', kind: 'image', aspectRatios: ['1:1'], maxReferenceImages: 1, requiresImageInput: true }],
};
await writeFile(join(echoFolder, 'provider.json'), JSON.stringify(echoManifest));
await writeFile(join(echoFolder, 'provider.mjs'), `export async function createGeneration({input,media,readMedia}) {
  if(media.length!==1 || input._referenceProjectId) throw Error('Invalid public contract');
  const source=await readMedia(input.imageUrls[0]);
  if('filePath' in source || 'objectKey' in source) throw Error('Host path escaped');
  return {status:'succeeded',media:[{data:source.bytes,mimeType:source.mimeType}]};
}`);
const { installGenerationProviders } = await import('./installed/install.server');
assert.equal(installGenerationProviders(providers).problems.length, 0);
const { createProject } = await import('../projects/projects');
const { persistLocalProjectAsset } = await import('../projects/local-project-assets');
const { recordUserAsset, linkProjectAsset, listProjectAssets } = await import('../workspace-lib/assets/user-assets');
const { preflightAssetFirstGeneration, submitAssetFirstGeneration } = await import('./submit');
const { listProjectGenerations } = await import('../effects/project-generations');
const { listGenerationModelDescriptors } = await import('./model-catalog');
const { createProviderMediaContext, prepareLocalGenerationReferences } = await import('./local-media.server');
const { parseLocalReference, localReferenceUrl } = await import('./local-reference');
const { normalizeAssetFirstGenerationRequest } = await import('../commands/generation-contract');
const { InstalledProviderRuntime } = await import('./installed/runtime.server');
const { providerManifestSchema } = await import('./installed/manifest');

const sourcePath = join(directory, 'source.mp4');
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=180x320:r=12:d=1', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourcePath]);
const video = await readFile(sourcePath);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z+uIAAAAASUVORK5CYII=', 'base64');
async function fixture(kind: 'video' | 'image' = 'video') {
  const project = await createProject({ name: 'Local provider input' });
  const mimeType = kind === 'video' ? 'video/mp4' : 'image/png';
  const saved = await persistLocalProjectAsset({ projectId: project.id, filename: kind === 'video' ? 'input.mp4' : 'input.png', mimeType, bytes: kind === 'video' ? video : png });
  await recordUserAsset({ id: saved.assetId, type: kind, source: 'upload', bucket: 'local-project-assets', storageProvider: 'local', objectKey: saved.objectKey, publicUrl: saved.publicUrl, sha256: saved.sha256, sizeBytes: saved.sizeBytes, filename: saved.filename, mimeType });
  await linkProjectAsset({ projectId: project.id, assetId: saved.assetId, role: 'upload' });
  const request = normalizeAssetFirstGenerationRequest({ version: 2, projectId: project.id, mode: kind === 'video' ? 'analysis' : 'image', modelId: kind === 'video' ? 'vertical-delivery-review' : 'local-image-copy', prompt: 'Check this original', references: [{ assetId: saved.assetId, role: 'reference' }], parameters: kind === 'video' ? {} : { aspect_ratio: '1:1', _referenceProjectId: 'forged-caller-project' } });
  return { project, saved, request };
}

test('installed technical analysis consumes actual owned bytes without a managed upload and retains playable history', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Local provider attempted network access'); });
  const { request, saved } = await fixture();
  assert.equal(listGenerationModelDescriptors().find(item => item.id === request.modelId)?.referenceDelivery, 'project-media');
  const admission = await preflightAssetFirstGeneration(request);
  assert.equal(admission.expectedUploadCount, 0);
  assert.ok(admission.preparedReferences?.authorizedDeliveryUrls[0].includes(saved.sha256));
  const result = await submitAssetFirstGeneration({ generation: request, origin: 'mcp' });
  assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
  const [history] = await listProjectGenerations(request.projectId);
  assert.match(history.resultText!, /180 × 320/);
  assert.match(history.resultText!, /Audio: 1 stream/);
  assert.ok(history.resultText!.includes(saved.sha256));
  assert.deepEqual(history.referenceVideos, [saved.publicUrl]);
  assert.deepEqual([...new Set((await listProjectAssets({ projectId: request.projectId })).map((asset: { id: string }) => asset.id))], [saved.assetId]);
});

test('general image providers use the same reader and register actual returned media', async () => {
  const { request, saved } = await fixture('image');
  const result = await submitAssetFirstGeneration({ generation: request, origin: 'cli' });
  assert.equal(result.body.status, 'succeeded', JSON.stringify(result));
  const assets = await listProjectAssets({ projectId: request.projectId });
  assert.ok(assets.some((asset: { id: string; sha256?: string | null }) => asset.id !== saved.assetId && asset.sha256 === saved.sha256));
  assert.deepEqual((await listProjectGenerations(request.projectId))[0].referenceImages, [saved.publicUrl]);
});

test('foreign ownership, altered bytes, symlinks and noncanonical references cannot enter a provider', async () => {
  const { request, saved } = await fixture();
  const foreign = await createProject({ name: 'Other project' });
  await assert.rejects(preflightAssetFirstGeneration({ ...request, projectId: foreign.id }));
  const prepared = await prepareLocalGenerationReferences(request);
  const url = prepared.authorizedDeliveryUrls[0];
  for (const bad of [url + '?x=1', url + '#x', url + '/extra', url.replace('/video/', '/audio/../video/')]) assert.equal(parseLocalReference(bad), null);
  await assert.rejects(createProviderMediaContext(foreign.id, { videoUrl: url }, AbortSignal.timeout(5000)), /authorized/);
  await writeFile(saved.filePath, Buffer.alloc(saved.sizeBytes));
  await assert.rejects(createProviderMediaContext(request.projectId, { videoUrl: url }, AbortSignal.timeout(5000)), /content changed/);
  await rm(saved.filePath);
  await symlink(sourcePath, saved.filePath);
  await assert.rejects(preflightAssetFirstGeneration(request), /Symbolic/);
});

test('readers recheck pinned bytes, reject undeclared refs, enforce reference budgets and close after calls', async () => {
  const { request, saved } = await fixture();
  const prepared = await prepareLocalGenerationReferences(request);
  const url = prepared.authorizedDeliveryUrls[0];
  const context = await createProviderMediaContext(request.projectId, { videoUrl: url }, AbortSignal.timeout(5000));
  assert.throws(() => context.readMedia(url + 'x'), /not admitted/);
  const first = await context.readMedia(url);
  first.bytes.fill(0);
  assert.deepEqual(Buffer.from((await context.readMedia(url)).bytes), video);
  await writeFile(saved.filePath, Buffer.alloc(saved.sizeBytes));
  await assert.rejects(context.readMedia(url), /content changed/);
  await context.dispose();
  assert.throws(() => context.readMedia(url), /closed/);
  const pin = parseLocalReference(url)!;
  const tooLarge = Array.from({ length: 5 }, (_, i) => localReferenceUrl({ ...pin, assetId: 'fake-' + i, sizeBytes: 64 * 1024 * 1024 }));
  await assert.rejects(createProviderMediaContext(request.projectId, { imageUrls: tooLarge }, AbortSignal.timeout(5000)), /budget/);
});

test('runtime closes readers even on module failure and never gives them to polling', async () => {
  const { request } = await fixture();
  const { authorizedDeliveryUrls: [url] } = await prepareLocalGenerationReferences(request);
  const manifest = providerManifestSchema.parse(echoManifest);
  const runtime = new InstalledProviderRuntime(manifest, `let reader,ref;
    export async function createGeneration({input,readMedia}) { reader=readMedia; ref=input.imageUrls[0]; await reader(ref); if(input.prompt==='queue') return {status:'processing',taskId:'test'}; throw Error('Intentional failure'); }
    export async function checkStatus(request) { if(request.readMedia || request.media) throw Error('Reader leaked to poll');
      try { await reader(ref); } catch(error) { if(error.message.includes('closed')) return {status:'failed',error:'Reader correctly closed'}; throw error; }
      throw Error('Reader remained active'); }`);
  const effect = { linkName: 'local-image-copy', type: 2 } as EffectRecord;
  assert.match((await runtime.call('createGeneration', effect, { input: { imageUrls: [url] } }, request.projectId)).error!, /Intentional failure/);
  assert.equal((await runtime.call('checkStatus', effect, { taskId: 'test' })).error, 'Reader correctly closed');
  assert.equal((await runtime.call('createGeneration', effect, { input: { imageUrls: [url], prompt: 'queue' } }, request.projectId)).status, 'processing');
  assert.equal((await runtime.call('checkStatus', effect, { taskId: 'test' })).error, 'Reader correctly closed');
  const invalid = new InstalledProviderRuntime(manifest, 'throw Error("Module executed before validation");');
  assert.match((await invalid.call('createGeneration', effect, { input: { imageUrls: [url] } }, 'other-project')).error!, /authorized local reference/);
});
