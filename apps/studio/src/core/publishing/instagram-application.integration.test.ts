import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMetaFixture } from '../../../tests/support/meta-fixture';
import { PublicationRequestError } from './requests';
import { InstagramVideoError, validateInstagramVideo } from './instagram-video.server';

const directory = await mkdtemp(join(tmpdir(), 'vh-instagram-app-'));
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
const { publicationPreview } = await import('../../routes/api/app/publishing/-preview-http.server');
const video = join(directory, 'source.mp4'), short = join(directory, 'short.mp4');
for (const [file, duration] of [[video, '3.2'], [short, '1']]) execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=108x192:r=30:d=${duration}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file]);
const signal = () => AbortSignal.timeout(20000);
const fails = (code: PublicationRequestError['code']) => (error: unknown) => error instanceof PublicationRequestError && error.code === code;
async function fixture() {
  const project = await createProject({ name: 'Instagram publication' }), asset = await importLocalProjectAsset({ projectId: project.id, filePath: video });
  const remote = createMetaFixture(), accounts = openInstagramAccounts({ fetch: remote.request });
  try {
    const binding = 'b'.repeat(43), flow = accounts.begin(binding), state = new URL(flow.authorizationUrl).searchParams.get('state')!;
    const callback = new URL(process.env.VIRAL_HIT_META_REDIRECT_URI!); callback.search = new URLSearchParams({ state, code: 'fixture-code' }).toString();
    await accounts.complete(callback, binding, signal());
    const account = await accounts.select(state, binding, '111', signal());
    return { projectId: project.id, remote, account, request: { action: 'create' as const, requestKey: randomUUID(), connector: 'instagram' as const, accountId: account.id, assetId: asset.id, metadata: { kind: 'reel' as const, caption: 'An experiment in light', isAiGenerated: true } } };
  } finally { accounts.close(); }
}

test('Instagram admission probes retained bytes, isolates accounts and rejects invalid revisions without publishing', async () => {
  const f = await fixture(), foreign = await createProject({ name: 'Foreign' });
  await assert.rejects(changePublication(foreign.id, f.request, 'mcp'), fails('media-unavailable'));
  await assert.rejects(changePublication(f.projectId, { ...f.request, pageId: '112' }, 'cli'), fails('invalid-input'));
  await assert.rejects(changePublication(f.projectId, { ...f.request, metadata: { ...f.request.metadata, publishAt: '2030-01-01T00:00:00Z' } }, 'ui'), fails('invalid-input'));
  const shortAsset = await importLocalProjectAsset({ projectId: f.projectId, filePath: short });
  await assert.rejects(changePublication(f.projectId, { ...f.request, assetId: shortAsset.id }, 'ui'), error => fails('media-unavailable')(error) && /3–900/.test((error as Error).message));
  const draft = await changePublication(f.projectId, f.request, 'cli');
  assert.equal(draft.destinationId, '222'); assert.equal(draft.instagramMetadata?.kind, 'reel'); assert.equal(draft.metadata, null); assert.equal(draft.delivery, null);
  const preview = await publicationPreview(f.projectId, draft.id, new Request(`http://127.0.0.1:3808/api/app/projects/${f.projectId}/publications/${draft.id}/media?digest=${draft.digest}`));
  assert.equal(preview.status, 200); assert.deepEqual(Buffer.from(await preview.arrayBuffer()), await readFile(video));
  const { requestKey: _, ...fields } = f.request;
  const revised = await changePublication(f.projectId, { ...fields, action: 'revise', publicationId: draft.id, expectedRevision: 1, metadata: { kind: 'story', isAiGenerated: false } }, 'mcp');
  assert.equal(revised.instagramMetadata?.kind, 'story'); assert.equal(revised.revision, 2);
  await assert.rejects(changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 2, expectedDigest: draft.digest, confirmed: true }, 'ui'), fails('conflict'));
  const app = process.env.VIRAL_HIT_META_APP_ID; delete process.env.VIRAL_HIT_META_APP_ID;
  try { await assert.rejects(changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 2, expectedDigest: revised.digest, confirmed: true }, 'ui'), fails('runtime-unavailable')); }
  finally { process.env.VIRAL_HIT_META_APP_ID = app; }
  const accounts = openInstagramAccounts(); try { accounts.disconnect(f.account.id, f.account.revision); } finally { accounts.close(); }
  await assert.rejects(changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 2, expectedDigest: revised.digest, confirmed: true }, 'ui'), fails('account-unavailable'));
  assert.equal(f.remote.calls.some(call => call.path.includes('media')), false);
});

for (const lostReply of [false, true]) test(`application and lazy runtime upload once and reconcile ${lostReply ? 'a lost publish reply' : 'a published receipt'}`, async () => {
  const f = await fixture(), draft = await changePublication(f.projectId, f.request, 'ui');
  await changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 1, expectedDigest: draft.digest, confirmed: true }, 'ui');
  let creates = 0, publishes = 0, uploads = 0, published = false, received = Buffer.alloc(0);
  const bytes = await readFile(video), fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/v26.0/111') return f.remote.request(input, init);
    if (url.pathname === '/v26.0/222/media') {
      creates++; assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-meta-page-111');
      assert.deepEqual(JSON.parse(init!.body as string), { media_type: 'REELS', upload_type: 'resumable', is_ai_generated: true, caption: f.request.metadata.caption });
      return Response.json({ id: '333', uri: 'https://rupload.facebook.com/ig-api-upload/v26.0/333' });
    }
    if (url.pathname === '/ig-api-upload/v26.0/333') {
      uploads++; received = Buffer.from(await new Response(init!.body).arrayBuffer());
      return Response.json({ success: true });
    }
    if (url.pathname === '/v26.0/333') return Response.json({ id: '333', status_code: published ? 'PUBLISHED' : received.length ? 'FINISHED' : 'IN_PROGRESS', video_status: { uploading_phase: { status: received.length ? 'complete' : 'not_started', bytes_transferred: received.length } } });
    assert.equal(url.pathname, '/v26.0/222/media_publish'); assert.equal(init?.method, 'POST'); publishes++; published = true;
    if (lostReply) throw new Error('Fixture socket closed after commit');
    return Response.json({ id: '444' });
  };
  const store = openPublications(); let runtime = openPublicationRuntime({ fetch: fetcher });
  const realNow = Date.now;
  try {
    assert.equal((await runPublicationStep(store, runtime))?.state, 'uploading');
    runtime.close(); runtime = openPublicationRuntime({ fetch: fetcher });
    assert.equal((await runPublicationStep(store, runtime))?.state, 'accepted');
    assert.equal((await runPublicationStep(store, runtime))?.state, 'staged');
    // Persistent store reads its injected Date.now function; advance wall time for the poll fence.
    const staged = store.get(f.projectId, draft.id)!;
    store.close(); Date.now = () => staged.nextPoll + 1;
    const resumed = openPublications();
    try {
      assert.equal((await runPublicationStep(resumed, runtime))?.state, lostReply ? 'uncertain' : 'published');
      if (lostReply) { resumed.reconcile(f.projectId, draft.id, 1); assert.equal((await runPublicationStep(resumed, runtime))?.state, 'published'); }
      assert.equal(creates, 1); assert.equal(uploads, 1); assert.equal(publishes, 1); assert.deepEqual(received, bytes);
      const view = (await listPublications(f.projectId)).publications[0];
      assert.equal(view.state, 'published'); assert.equal(view.instagramDelivery?.status, 'PUBLISHED');
      assert.equal(view.instagramDelivery?.mediaId, lostReply ? undefined : '444'); assert.equal(view.delivery, null);
      assert.doesNotMatch(JSON.stringify(view), /fixture-meta|accessToken|leaseToken|checkpoint|rupload/);
    } finally { resumed.close(); }
  } finally { Date.now = realNow; runtime.close(); }
});

test('video admission enforces format-specific durations, codec, FPS, size and audio while accepting silent portrait video', () => {
  const probe = { format: { duration: 3, format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p', field_order: 'progressive', avg_frame_rate: '30/1' }] };
  const story = { kind: 'story' as const, isAiGenerated: false };
  validateInstagramVideo(probe, 1000, story);
  for (const bad of [
    { ...probe, format: { ...probe.format, duration: 60.1 } },
    { ...probe, streams: [{ ...probe.streams[0], codec_name: 'vp9' }] },
    { ...probe, streams: [{ ...probe.streams[0], avg_frame_rate: '0/0' }] },
    { ...probe, streams: [{ ...probe.streams[0], field_order: 'tt' }] },
    { ...probe, streams: [...probe.streams, { codec_type: 'audio', codec_name: 'mp3' }] },
  ]) assert.throws(() => validateInstagramVideo(bad, 1000, story), InstagramVideoError);
  assert.throws(() => validateInstagramVideo(probe, 100000001, story), /100 MB/);
  validateInstagramVideo({ ...probe, format: { ...probe.format, duration: 900 } }, 300000000, { kind: 'reel', caption: '', isAiGenerated: true });
});
