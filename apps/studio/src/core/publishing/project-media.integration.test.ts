import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PublicationStore } from './store.server';
import { createYouTubeConnector } from './youtube-connector.server';
import { runPublicationStep } from './worker.server';
import type { PublicationAsset, PublicationSpec } from './contracts';

const directory = await mkdtemp(join(tmpdir(), 'vh-publication-project-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { createProject, deleteProjects } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { openProjectPublicationMedia } = await import('./project-media.server');
const video = join(directory, 'source.mp4'), audio = join(directory, 'source.wav');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', audio]);
const signal = () => AbortSignal.timeout(20000);
const specFor = (projectId: string, asset: PublicationAsset): PublicationSpec => ({
  schemaVersion: 1, projectId, connector: 'youtube', connectorVersion: '1', accountId: 'account', destinationId: 'channel', assets: [asset],
  metadata: { title: 'Reviewed project export', description: '', categoryId: '22', privacy: 'private', tags: [], madeForKids: false, containsSyntheticMedia: true, notifySubscribers: false },
});
async function fixture(filePath = video) {
  const project = await createProject({ name: 'Publication source' });
  const asset = await importLocalProjectAsset({ projectId: project.id, filePath });
  const source = await getProjectAssetById({ projectId: project.id, assetId: asset.id }); assert.ok(source);
  return { project, asset, source: resolveLocalProjectAssetPath({ objectKey: source.objectKey }) };
}

test('project boundary retains image, audio and video pins with real bytes and no public host paths', async () => {
  const media = openProjectPublicationMedia();
  try {
    for (const filePath of [resolve('public/logo.png'), audio, video]) {
      const f = await fixture(filePath), original = await readFile(filePath);
      const pin = await media.pin(f.project.id, f.asset.id, signal());
      assert.equal(pin.sha256, createHash('sha256').update(original).digest('hex'));
      assert.equal(pin.sizeBytes, original.length);
      assert.deepEqual(Object.keys(pin).sort(), ['assetId', 'contentType', 'sha256', 'sizeBytes']);
      await rm(f.source);
      const spec = specFor(f.project.id, pin);
      await media.validateAssets(spec, signal());
      assert.deepEqual(Buffer.from(await media.read(spec, 0, 0, pin.sizeBytes, signal())), original);
    }
  } finally { media.close(); }
});

test('foreign membership, deleted projects, changed sources and invented pins cannot reach the reader', async () => {
  const media = openProjectPublicationMedia();
  try {
    const f = await fixture(), foreign = await createProject({ name: 'Another project' });
    await assert.rejects(media.pin(foreign.id, f.asset.id, signal()), /belonging/);
    const pin = await media.pin(f.project.id, f.asset.id, signal()), spec = specFor(f.project.id, pin);
    await assert.rejects(media.validateAssets({ ...spec, projectId: foreign.id }, signal()), /not been retained/);
    await assert.rejects(media.read(spec, 1, 0, 1, signal()), /Unknown/);
    await assert.rejects(media.validateAssets(specFor(f.project.id, { ...pin, sha256: '0'.repeat(64) }), signal()), /not been retained/);
    const bytes = await readFile(f.source); bytes[0] ^= 1; await writeFile(f.source, bytes);
    await assert.rejects(media.pin(f.project.id, f.asset.id, signal()), /changed/);
    await deleteProjects({ projectIds: [f.project.id] });
    await assert.rejects(media.validateAssets(spec, signal()), /unavailable/);
    await assert.rejects(media.read(spec, 0, 0, 1, signal()), /unavailable/);
  } finally { media.close(); }
});

test('real project video reaches the YouTube connector through retained storage after original deletion', async () => {
  const f = await fixture(), media = openProjectPublicationMedia(), store = new PublicationStore(join(directory, 'publications.sqlite'));
  const original = await readFile(f.source);
  let creations = 0, writes = 0, received = Buffer.alloc(0), mediaClosed = false;
  const session = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=retained-fixture';
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  const receipt = (uploadStatus: string) => ({ id: 'testVideo01', snippet: { channelId: 'channel' }, status: { privacyStatus: 'private', uploadStatus } });
  const connector = createYouTubeConnector({ accessToken: async account => { assert.equal(account, 'account'); return 'fixture'; }, fetch: async (url, init) => {
    if (String(url).includes('/channels?')) return json({ items: [{ id: 'channel', snippet: { title: 'Fixture channel' } }] });
    if (init?.method === 'POST') { creations++; return new Response(null, { headers: { location: session } }); }
    if (init?.method === 'PUT') {
      assert.equal(String(url), session);
      if (new Headers(init.headers).get('content-range')!.startsWith('bytes */')) return new Response(null, { status: 308 });
      writes++; received = Buffer.from(init.body as Uint8Array); return json(receipt('uploaded'));
    }
    return json({ items: [receipt('processed')] });
  } });
  try {
    const pin = await media.pin(f.project.id, f.asset.id, signal()), spec = specFor(f.project.id, pin);
    const draft = store.create(spec, 'retained-video'); store.approve(f.project.id, draft.id, 1, draft.digest, 'operator');
    await rm(f.source);
    const runtime = { ...media, connector: async () => connector };
    assert.equal((await runPublicationStep(store, runtime))?.state, 'uploading');
    assert.equal((await runPublicationStep(store, runtime))?.state, 'accepted');
    media.close(); mediaClosed = true;
    const reopened = openProjectPublicationMedia();
    try { assert.equal((await runPublicationStep(store, { ...reopened, connector: async () => connector }))?.state, 'ready'); }
    finally { reopened.close(); }
    assert.equal(creations, 1); assert.equal(writes, 1); assert.deepEqual(received, original);
    assert.equal(createHash('sha256').update(received).digest('hex'), pin.sha256);
  } finally { if (!mediaClosed) media.close(); store.close(); }
});

test('corrupt retained bytes pause the existing session before any media body is sent', async () => {
  const f = await fixture(), media = openProjectPublicationMedia(), store = new PublicationStore(':memory:');
  let writes = 0;
  const connector = createYouTubeConnector({ accessToken: async () => 'fixture', fetch: async (_url, init) => {
    if (init?.method === 'PUT') {
      if (!new Headers(init.headers).get('content-range')!.startsWith('bytes */')) writes++;
      return new Response(null, { status: 308 });
    }
    throw new Error('No new session may be created');
  } });
  try {
    const pin = await media.pin(f.project.id, f.asset.id, signal()), spec = specFor(f.project.id, pin);
    const draft = store.create(spec, 'damaged-video'); store.approve(f.project.id, draft.id, 1, draft.digest, 'operator');
    const claim = store.claim()!; store.begin(claim);
    store.checkpoint(claim, { sessionUrl: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=original', nextByte: 0 });
    const retained = join(directory, 'publication-media', f.project.id, f.asset.id, `${pin.sha256}.media`);
    const bytes = await readFile(retained); bytes[0] ^= 1; await chmod(retained, 0o600); await writeFile(retained, bytes);
    const result = await runPublicationStep(store, { ...media, connector: async () => connector });
    assert.equal(result?.state, 'uncertain'); assert.equal(result?.issue, 'asset-unavailable'); assert.equal(writes, 0);
    assert.equal(await runPublicationStep(store, { ...media, connector: async () => connector }), null);
  } finally { media.close(); store.close(); }
});
