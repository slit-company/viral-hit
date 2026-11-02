import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramConnector } from './instagram-connector.server';
import { PublicationPublishError, PublicationStartError, type PublicationConnector, type PublicationSpec } from './contracts';
import type { PublicImageHost } from './public-image-host.server';
import { PublicationStore } from './store.server';
import { runPublicationStep } from './worker.server';
import type { JsonValue } from '../../lib/canonical-json';

const jpeg = (letter: string, sizeBytes = 12) => ({ assetId: `photo-${letter}`, sha256: letter.repeat(64), sizeBytes, contentType: 'image/jpeg' });
const base = { schemaVersion: 1 as const, projectId: 'project', connector: 'instagram', connectorVersion: '1', accountId: 'account', destinationId: '222' };
const imageSpec: PublicationSpec = { ...base, assets: [jpeg('a')], metadata: { kind: 'image', caption: 'Morning light #studio', altText: 'A red chair by a window', isAiGenerated: true } };
const carouselSpec: PublicationSpec = { ...base, assets: [jpeg('a'), { assetId: 'clip', sha256: 'b'.repeat(64), sizeBytes: 10, contentType: 'video/mp4' }, jpeg('c')], metadata: { kind: 'carousel', caption: 'Three frames', altTexts: ['First frame', '', 'Last frame'], isAiGenerated: true } };
const url = (letter: string) => `https://media.example.com/instagram/${letter.repeat(64)}.jpg`;
const signal = () => AbortSignal.timeout(10000);
const read = async (_asset: number, _offset: number, length: number) => new Uint8Array(length);

function host(reachable = true) {
  const published: string[] = [];
  const value: PublicImageHost = {
    configured: async () => true,
    verify: async image => reachable ? `https://media.example.com/instagram/${image.sha256}.jpg` : null,
    publish: async (image, bytes) => { assert.equal((await bytes()).length, image.sizeBytes); published.push(image.sha256[0]); return `https://media.example.com/instagram/${image.sha256}.jpg`; },
  };
  return { value, published };
}
function meta() {
  let next = 500, carousel = 'IN_PROGRESS', reject = false;
  const containers = new Map<string, { status: string; video?: { uploaded: number; size: number } }>();
  const calls: { method: string; path: string; fields: string | null; body?: Record<string, unknown> }[] = [];
  const request: typeof fetch = async (input, init) => {
    const target = new URL(String(input)), method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ method, path: target.pathname, fields: target.searchParams.get('fields'), body });
    assert.equal(init?.redirect, 'error');
    if (target.pathname === '/v26.0/111') return Response.json({ id: '111', instagram_business_account: { id: '222' } });
    if (target.pathname === '/v26.0/222/media' && method === 'POST') {
      if (reject) return Response.json({ error: { code: 9004, message: 'fixture rejection' } }, { status: 400 });
      const id = String(next++);
      if (body?.media_type === 'VIDEO') { containers.set(id, { status: 'IN_PROGRESS', video: { uploaded: 0, size: 10 } }); return Response.json({ id, uri: `https://rupload.facebook.com/ig-api-upload/v26.0/${id}` }); }
      containers.set(id, { status: body?.media_type === 'CAROUSEL' ? carousel : 'FINISHED' });
      return Response.json({ id });
    }
    if (target.hostname === 'rupload.facebook.com') {
      const item = containers.get(target.pathname.split('/').pop()!)!;
      item.video!.uploaded += (await new Response(init!.body).arrayBuffer()).byteLength; item.status = 'FINISHED';
      return Response.json({ success: true });
    }
    if (target.pathname === '/v26.0/222/media_publish') { containers.get(String(body?.creation_id))!.status = 'PUBLISHED'; return Response.json({ id: '900' }); }
    const id = target.pathname.match(/^\/v26\.0\/(\d+)$/)?.[1], item = id ? containers.get(id) : undefined;
    if (item && method === 'GET') {
      // Image and carousel containers are read without the video-only field.
      assert.equal(target.searchParams.get('fields'), item.video ? 'id,status_code,video_status' : 'id,status_code');
      return Response.json({ id, status_code: item.status, ...(item.video ? { video_status: { uploading_phase: { status: item.video.uploaded === item.video.size ? 'complete' : 'in_progress', bytes_transferred: item.video.uploaded } } } : {}) });
    }
    throw new Error(`Unexpected fixture request ${method} ${target}`);
  };
  return { request, calls, containers, posts: () => calls.filter(call => call.method === 'POST' && call.path === '/v26.0/222/media'),
    finishCarousel: () => { carousel = 'FINISHED'; for (const item of containers.values()) if (item.status === 'IN_PROGRESS' && !item.video) item.status = 'FINISHED'; }, reject: () => { reject = true; } };
}
function connector(remote = meta(), images = host()) {
  return { remote, images, value: createInstagramConnector({ fetch: remote.request, imageHost: images.value, carouselWaitMs: 1, credential: async () => ({ pageId: '111', instagramId: '222', accessToken: 'token' }) }) };
}

test('a single image post hosts the approved JPEG, creates one captioned container and publishes it once', async () => {
  const { value, remote, images } = connector();
  await value.prepare!(imageSpec, read, signal()); assert.deepEqual(images.published, ['a']);
  const checkpoint = await value.start(imageSpec, signal());
  assert.deepEqual(checkpoint, { post: 1, instagramId: '222', pageId: '111', items: [{ containerId: '500' }] });
  assert.deepEqual(remote.posts().map(call => call.body), [{ image_url: url('a'), caption: 'Morning light #studio', is_ai_generated: true, alt_text: 'A red chair by a window' }]);
  const transfer = await value.transfer(imageSpec, checkpoint, read, signal());
  assert.equal(transfer.kind, 'accepted');
  const receipt = (transfer as { receipt: JsonValue }).receipt;
  assert.deepEqual(receipt, { post: 1, instagramId: '222', pageId: '111', items: ['500'], containerId: '500', status: 'IN_PROGRESS' });
  const staged = await value.inspect(imageSpec, receipt, signal()); assert.equal(staged.state, 'staged');
  const published = await value.publish!(imageSpec, staged.receipt, signal());
  assert.equal(published.state, 'published'); assert.equal((published.receipt as { mediaId?: string }).mediaId, '900');
  assert.deepEqual(remote.calls.filter(call => call.path.endsWith('/media_publish')).map(call => call.body), [{ creation_id: '500' }]);
});

test('an image Story is a STORIES container without caption or alt text', async () => {
  const { value, remote } = connector(), spec: PublicationSpec = { ...imageSpec, metadata: { kind: 'story', frame: 'fit', isAiGenerated: false } };
  await value.start(spec, signal());
  assert.deepEqual(remote.posts().map(call => call.body), [{ image_url: url('a'), media_type: 'STORIES', is_ai_generated: false }]);
});

test('a carousel creates bare items, uploads its video, then creates and publishes the captioned carousel inside the publishing step', async () => {
  const { value, remote } = connector();
  const checkpoint = await value.start(carouselSpec, signal());
  assert.deepEqual(checkpoint, { post: 1, instagramId: '222', pageId: '111', items: [{ containerId: '500' }, { containerId: '501', nextByte: 0 }, { containerId: '502' }] });
  assert.deepEqual(remote.posts().map(call => call.body), [
    { image_url: url('a'), is_carousel_item: true, alt_text: 'First frame' },
    { media_type: 'VIDEO', is_carousel_item: true, upload_type: 'resumable' },
    { image_url: url('c'), is_carousel_item: true, alt_text: 'Last frame' },
  ]);
  const transfer = await value.transfer(carouselSpec, checkpoint, read, signal());
  assert.equal(transfer.kind, 'accepted'); assert.equal(remote.containers.get('501')?.video?.uploaded, 10);
  const receipt = (transfer as { receipt: JsonValue }).receipt;
  assert.deepEqual(receipt, { post: 1, instagramId: '222', pageId: '111', items: ['500', '501', '502'], status: 'IN_PROGRESS' });
  const staged = await value.inspect(carouselSpec, receipt, signal()); assert.equal(staged.state, 'staged');
  // Meta is still processing the new carousel: nothing was published, so the step defers and keeps the container.
  const deferred = await value.publish!(carouselSpec, staged.receipt, signal()).then(() => null, error => error);
  assert.ok(deferred instanceof PublicationPublishError); assert.equal(deferred.outcome, 'unavailable');
  assert.deepEqual(deferred.receipt, { post: 1, instagramId: '222', pageId: '111', items: ['500', '501', '502'], containerId: '503', status: 'IN_PROGRESS', carouselPolls: 1 });
  assert.deepEqual(remote.posts().at(-1)?.body, { media_type: 'CAROUSEL', children: '500,501,502', caption: 'Three frames', is_ai_generated: true });
  assert.equal(remote.calls.some(call => call.path.endsWith('/media_publish')), false);
  remote.finishCarousel();
  const published = await value.publish!(carouselSpec, deferred.receipt, signal());
  assert.equal(published.state, 'published');
  assert.equal(remote.posts().filter(call => call.body?.media_type === 'CAROUSEL').length, 1);
  assert.deepEqual(remote.calls.filter(call => call.path.endsWith('/media_publish')).map(call => call.body), [{ creation_id: '503' }]);
});

test('start creates nothing when the hosted image is unreachable, and reports a definitive Meta refusal as rejected', async () => {
  const unreachable = connector(meta(), host(false));
  await assert.rejects(unreachable.value.start(imageSpec, signal()), error => error instanceof PublicationStartError && error.outcome === 'unavailable');
  assert.equal(unreachable.remote.posts().length, 0);
  const refused = connector(); refused.remote.reject();
  await assert.rejects(refused.value.start(carouselSpec, signal()), error => error instanceof PublicationStartError && error.outcome === 'rejected');
});

test('the worker keeps an approved post waiting while hosting fails and stores a deferred carousel receipt', async () => {
  let now = 1000, hosting = false;
  const store = new PublicationStore(':memory:', () => now), draft = store.create(carouselSpec, 'carousel');
  const deferred = { post: 1, instagramId: '222', pageId: '111', items: ['500', '501', '502'], containerId: '503', status: 'IN_PROGRESS', carouselPolls: 1 };
  const fixture: PublicationConnector = {
    id: 'instagram', version: '1',
    async prepare() { if (!hosting) throw new Error('storage offline'); },
    async start() { return { post: 1 }; },
    async transfer() { return { kind: 'accepted', receipt: { post: 1 } }; },
    async reconcile() { return { kind: 'accepted', receipt: { post: 1 } }; },
    async inspect(_spec, receipt) { return { state: 'staged', receipt }; },
    async publish() { throw new PublicationPublishError('unavailable', 30000, deferred); },
  };
  const runtime = { async connector() { return fixture; }, async validateAssets() {}, async read() { return new Uint8Array(); } };
  try {
    store.approve('project', draft.id, 1, draft.digest, 'operator');
    const waiting = await runPublicationStep(store, runtime);
    assert.equal(waiting?.state, 'approved'); assert.equal(waiting?.issue, 'hosting-unavailable');
    hosting = true; now += 60001;
    for (let step = 0; step < 4; step++) { await runPublicationStep(store, runtime); now += 30001; }
    const record = store.get('project', draft.id)!;
    assert.equal(record.state, 'staged'); assert.equal(record.issue, null); assert.deepEqual(record.receipt, deferred);
  } finally { store.close(); }
});
