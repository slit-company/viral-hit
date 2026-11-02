import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMetaFixture } from '../../../tests/support/meta-fixture';
import { PublicationRequestError } from './requests';

const directory = await mkdtemp(join(tmpdir(), 'vh-instagram-post-'));
Object.assign(process.env, { VIRAL_HIT_DATA_DIR: directory, VIRAL_HIT_META_APP_ID: '123', VIRAL_HIT_META_APP_SECRET: 'fixture-only', VIRAL_HIT_META_LOGIN_CONFIG_ID: '456', VIRAL_HIT_META_REDIRECT_URI: 'http://127.0.0.1:3808/api/app/publishing/instagram/callback' });
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { changePublication, listPublications } = await import('./application.server');
const { openPublications } = await import('./publication-files.server');
const { openPublicationRuntime } = await import('./runtime.server');
const { openInstagramAccounts } = await import('./instagram-accounts.server');
const { runPublicationStep } = await import('./worker.server');
const { saveConfigs } = await import('../../modules/config/service');
const { probeInstagramImage } = await import('./instagram-image.server');
const { publicationPreview } = await import('../../routes/api/app/publishing/-preview-http.server');

const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', files = { tall: join(directory, 'tall.png'), square: join(directory, 'square.png'), clip: join(directory, 'clip.mp4') };
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920', '-frames:v', '1', files.tall]);
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'mandelbrot=s=1024x1024', '-frames:v', '1', files.square]);
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=108x192:r=30:d=3.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', files.clip]);
const signal = () => AbortSignal.timeout(30000);
const fails = (code: PublicationRequestError['code'], pattern?: RegExp) => (error: unknown) => error instanceof PublicationRequestError && error.code === code && (!pattern || pattern.test(error.message));
const storage = { WORKSPACE_STORAGE_MODE: 's3', R2_ENDPOINT: 'https://storage.example.com', R2_ACCESS_KEY_ID: 'fixture-access', R2_SECRET_ACCESS_KEY: 'fixture-secret', R2_BUCKET_NAME: 'studio-media', R2_PUBLIC_URL: 'https://media.example.com' };

async function fixture() {
  const project = await createProject({ name: 'Instagram carousel' });
  const [tall, square, clip] = [await importLocalProjectAsset({ projectId: project.id, filePath: files.tall }), await importLocalProjectAsset({ projectId: project.id, filePath: files.square }), await importLocalProjectAsset({ projectId: project.id, filePath: files.clip })];
  const remote = createMetaFixture(), accounts = openInstagramAccounts({ fetch: remote.request });
  try {
    const binding = 'c'.repeat(43), flow = accounts.begin(binding), state = new URL(flow.authorizationUrl).searchParams.get('state')!;
    const callback = new URL(process.env.VIRAL_HIT_META_REDIRECT_URI!); callback.search = new URLSearchParams({ state, code: 'fixture-code' }).toString();
    await accounts.complete(callback, binding, signal());
    const account = await accounts.select(state, binding, '111', signal());
    const carousel = { action: 'create' as const, requestKey: randomUUID(), connector: 'instagram' as const, accountId: account.id, assetIds: [tall.id, clip.id, square.id],
      metadata: { kind: 'carousel' as const, caption: 'Three studies #process', altTexts: ['A tall test pattern', '', 'A fractal'], isAiGenerated: true } };
    return { projectId: project.id, remote, account, tall, square, clip, carousel };
  } finally { accounts.close(); }
}
async function preview(projectId: string, view: { id: string; digest: string }, index: number) {
  const response = await publicationPreview(projectId, view.id, new Request(`http://127.0.0.1:3808/api/app/projects/${projectId}/publications/${view.id}/media?digest=${view.digest}&asset=${index}`));
  assert.equal(response.status, 200);
  const file = join(directory, `preview-${randomUUID()}.jpg`); await writeFile(file, Buffer.from(await response.arrayBuffer()));
  return { type: response.headers.get('content-type'), size: await probeInstagramImage(file, signal()) };
}

test('image formats need public storage, become the reviewed JPEG and reject media that does not fit the format', async () => {
  const f = await fixture();
  await assert.rejects(changePublication(f.projectId, f.carousel, 'ui'), fails('runtime-unavailable', /public link/));
  await saveConfigs(storage);
  const single = { ...f.carousel, requestKey: randomUUID(), assetIds: undefined, assetId: f.clip.id, metadata: { kind: 'image' as const, caption: '', isAiGenerated: false } };
  delete (single as { assetIds?: unknown }).assetIds;
  await assert.rejects(changePublication(f.projectId, single, 'mcp'), fails('invalid-input', /need an image/));
  await assert.rejects(changePublication(f.projectId, { ...f.carousel, requestKey: randomUUID(), assetIds: [f.tall.id] }, 'cli'), fails('invalid-input', /2 to 20/));
  await assert.rejects(changePublication(f.projectId, { ...f.carousel, requestKey: randomUUID(), metadata: { ...f.carousel.metadata, altTexts: ['', 'A video'] } }, 'ui'), fails('invalid-input', /images only/));
  const draft = await changePublication(f.projectId, f.carousel, 'ui');
  assert.deepEqual(draft.assets.map(asset => asset.contentType), ['image/jpeg', 'video/mp4', 'image/jpeg']);
  assert.equal(draft.assets[0].assetId, f.tall.id); assert.notEqual(draft.assets[0].sizeBytes, f.tall.sizeBytes);
  assert.equal(draft.instagramMetadata?.kind, 'carousel'); assert.equal(draft.bytesTotal, f.clip.sizeBytes);
  // Every image takes the first item's frame: 9:16 is cropped to 4:5, the square follows it.
  assert.deepEqual(await preview(f.projectId, draft, 0), { type: 'image/jpeg', size: { width: 1080, height: 1350 } });
  assert.deepEqual(await preview(f.projectId, draft, 2), { type: 'image/jpeg', size: { width: 818, height: 1022 } });
  const { requestKey: _, ...fields } = f.carousel;
  const fit = await changePublication(f.projectId, { ...fields, action: 'revise', publicationId: draft.id, expectedRevision: 1, metadata: { ...f.carousel.metadata, frame: 'fit' } }, 'mcp');
  assert.notEqual(fit.digest, draft.digest); assert.notEqual(fit.assets[0].sha256, draft.assets[0].sha256);
  assert.equal(f.remote.calls.some(call => call.path.includes('media')), false);
});

test('an approved carousel is hosted, uploaded and published once through the real runtime', async () => {
  const f = await fixture(); await saveConfigs(storage);
  const draft = await changePublication(f.projectId, { ...f.carousel, requestKey: randomUUID() }, 'ui');
  await changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 1, expectedDigest: draft.digest, confirmed: true }, 'ui');
  const hosted = new Map<string, number>(), posts: Record<string, unknown>[] = [], publishes: unknown[] = [];
  const containers = new Map<string, string>(); let next = 700, uploaded = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input)), method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.hostname === 'graph.facebook.com' && url.pathname === '/v26.0/111') return f.remote.request(input, init);
    if (url.hostname === 'storage.example.com' && method === 'PUT') { hosted.set(url.pathname, (await new Response(init?.body ?? null).arrayBuffer()).byteLength); return new Response(null, { status: 200 }); }
    if (url.hostname === 'media.example.com' && method === 'HEAD') {
      const size = hosted.get('/studio-media' + url.pathname);
      return size === undefined ? new Response(null, { status: 404 }) : new Response(null, { status: 200, headers: { 'content-length': String(size), 'content-type': 'image/jpeg' } });
    }
    if (url.pathname === '/v26.0/222/media' && method === 'POST') {
      const body = JSON.parse(String(init?.body)), id = String(next++); posts.push(body);
      if (body.image_url) assert.equal(hosted.has('/studio-media' + new URL(body.image_url).pathname), true);
      containers.set(id, body.media_type === 'VIDEO' ? 'IN_PROGRESS' : 'FINISHED');
      return body.media_type === 'VIDEO' ? Response.json({ id, uri: `https://rupload.facebook.com/ig-api-upload/v26.0/${id}` }) : Response.json({ id });
    }
    if (url.hostname === 'rupload.facebook.com') { uploaded = (await new Response(init?.body ?? null).arrayBuffer()).byteLength; containers.set(url.pathname.split('/').pop()!, 'FINISHED'); return Response.json({ success: true }); }
    if (url.pathname === '/v26.0/222/media_publish') { const body = JSON.parse(String(init?.body)); publishes.push(body); containers.set(body.creation_id, 'PUBLISHED'); return Response.json({ id: '990' }); }
    const id = url.pathname.match(/^\/v26\.0\/(\d+)$/)?.[1];
    if (id && containers.has(id)) {
      const video = url.searchParams.get('fields')?.includes('video_status');
      return Response.json({ id, status_code: containers.get(id), ...(video ? { video_status: { uploading_phase: { status: uploaded ? 'complete' : 'not_started', bytes_transferred: uploaded } } } : {}) });
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  const store = openPublications(), runtime = openPublicationRuntime({ fetch: fetcher });
  try {
    const states = [];
    for (let step = 0; step < 4; step++) states.push((await runPublicationStep(store, runtime))?.state);
    assert.deepEqual(states, ['uploading', 'accepted', 'staged', 'published']);
    assert.equal(hosted.size, 2); assert.equal(uploaded, f.clip.sizeBytes);
    assert.deepEqual(posts.map(body => body.media_type ?? 'IMAGE'), ['IMAGE', 'VIDEO', 'IMAGE', 'CAROUSEL']);
    assert.deepEqual(posts[3], { media_type: 'CAROUSEL', children: '700,701,702', caption: 'Three studies #process', is_ai_generated: true });
    assert.deepEqual(publishes, [{ creation_id: '703' }]);
    const view = (await listPublications(f.projectId)).publications.find(item => item.id === draft.id)!;
    assert.deepEqual(view.instagramDelivery, { containerId: '703', items: 3, instagramId: '222', pageId: '111', status: 'PUBLISHED', mediaId: '990' });
    assert.doesNotMatch(JSON.stringify(view), /fixture-secret|fixture-meta|accessToken|rupload/);
  } finally { runtime.close(); store.close(); }
});
