import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramConnector } from './instagram-connector.server';
import { INSTAGRAM_READ_BYTES } from './instagram-transport.server';
import { PublicationStartError, PublicationPublishError, type PublicationSpec } from './contracts';
import { PublicationStore } from './store.server';
import { runPublicationStep } from './worker.server';

const spec: PublicationSpec = { schemaVersion: 1, projectId: 'project', connector: 'instagram', connectorVersion: '1', accountId: 'account', destinationId: '222', assets: [{ assetId: 'asset', sha256: 'a'.repeat(64), sizeBytes: 10, contentType: 'video/mp4' }], metadata: { kind: 'reel', caption: 'A test reel', isAiGenerated: true } };
const signal = () => new AbortController().signal;
const checkpoint = { containerId: '333', instagramId: '222', pageId: '111', nextByte: 0 };
const receipt = { containerId: '333', instagramId: '222', pageId: '111', status: 'FINISHED' };
function fixture(size = 10) {
  let uploaded = 0, status = 'IN_PROGRESS', uploadStatus = 'in_progress', createUri = 'https://rupload.facebook.com/ig-api-upload/v26.0/333';
  let pageDestination = '222', tokenCalls = 0, losePublishReply = false, loseUploadReply = false;
  const calls: { method: string; url: URL; authorization: string | null; body?: unknown; offset?: number; chunks?: number[] }[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers), method = init?.method ?? 'GET';
    const call = { method, url, authorization: headers.get('authorization') } as (typeof calls)[number]; calls.push(call);
    assert.equal(init?.redirect, 'error');
    if (url.pathname === '/v26.0/111') return Response.json({ id: '111', instagram_business_account: { id: pageDestination } });
    if (url.pathname === '/v26.0/222/media') { call.body = JSON.parse(String(init?.body)); return Response.json({ id: '333', uri: createUri }); }
    if (url.pathname === '/v26.0/333') return Response.json({ id: '333', status_code: status, video_status: { uploading_phase: { status: uploadStatus, bytes_transferred: uploaded } } });
    if (url.hostname === 'rupload.facebook.com') {
      assert.equal(headers.get('file_size'), String(size)); assert.equal(headers.get('content-length'), String(size - uploaded));
      call.offset = Number(headers.get('offset')); assert.equal(call.offset, uploaded);
      const reader = (init?.body as ReadableStream<Uint8Array>).getReader(); call.chunks = [];
      try { while (true) { const { value, done } = await reader.read(); if (done) break; call.chunks.push(value.length); uploaded += value.length; } }
      finally { reader.releaseLock(); }
      uploadStatus = 'complete';
      if (loseUploadReply) throw new Error('Lost upload response');
      return Response.json({ success: true });
    }
    if (url.pathname === '/v26.0/222/media_publish') {
      call.body = JSON.parse(String(init?.body)); status = 'PUBLISHED';
      if (losePublishReply) throw new Error('Lost publish response');
      return Response.json({ id: '444' });
    }
    throw new Error('Unexpected fixture request');
  };
  const connector = createInstagramConnector({ fetch: request, credential: async accountId => {
    assert.equal(accountId, 'account'); tokenCalls++;
    return { pageId: '111', instagramId: '222', accessToken: `token-${tokenCalls}` };
  } });
  return { connector, calls,
    state: (next: string, bytes = size, phase = 'complete') => { status = next; uploaded = bytes; uploadStatus = phase; },
    badPage: () => { pageDestination = '555'; }, badUri: (uri: string) => { createUri = uri; },
    losePublish: () => { losePublishReply = true; }, loseUpload: () => { loseUploadReply = true; },
    read: async (_asset: number, _offset: number, length: number) => new Uint8Array(length),
  };
}

test('Instagram creates a container with explicit AI disclosure, uploads bytes, observes readiness and publishes separately', async () => {
  const f = fixture();
  const remote = await f.connector.start(spec, signal()); assert.deepEqual(remote, checkpoint);
  assert.deepEqual(f.calls[1].body, { media_type: 'REELS', upload_type: 'resumable', caption: 'A test reel', is_ai_generated: true });
  assert.equal(f.calls[0].authorization, f.calls[1].authorization);
  const upload = await f.connector.transfer(spec, remote, f.read, signal()); assert.equal(upload.kind, 'accepted');
  assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/media_publish')).length, 0);
  f.state('FINISHED'); assert.equal((await f.connector.inspect(spec, receipt, signal())).state, 'staged');
  const result = await f.connector.publish!(spec, receipt, signal()); assert.equal(result.state, 'published');
  assert.deepEqual(result.receipt, { ...receipt, status: 'PUBLISHED', mediaId: '444' });
  const publish = f.calls.at(-1)!; assert.deepEqual(publish.body, { creation_id: '333' });
  assert.equal(f.calls.at(-3)!.authorization, publish.authorization); assert.equal(f.calls.at(-2)!.authorization, publish.authorization);
});

test('upload resumes at server-confirmed offset, ignores stale checkpoint and uses bounded streaming reads', async () => {
  const size = INSTAGRAM_READ_BYTES * 2 + 7, f = fixture(size), input = { ...spec, assets: [{ ...spec.assets[0], sizeBytes: size }] };
  f.state('IN_PROGRESS', 5, 'in_progress'); const reads: [number, number][] = [];
  await f.connector.transfer(input, { ...checkpoint, nextByte: size - 1 }, async (_asset, offset, length) => { reads.push([offset, length]); return new Uint8Array(length); }, signal());
  assert.deepEqual(reads, [[5, INSTAGRAM_READ_BYTES], [5 + INSTAGRAM_READ_BYTES, INSTAGRAM_READ_BYTES], [5 + 2 * INSTAGRAM_READ_BYTES, 2]]);
  const upload = f.calls.find(c => c.url.hostname === 'rupload.facebook.com')!; assert.equal(upload.offset, 5); assert.deepEqual(upload.chunks, reads.map(r => r[1]));
  assert.equal(upload.authorization, f.calls[0].authorization?.replace('Bearer', 'OAuth'));
});

test('lost upload acknowledgement probes original container without retransmitting accepted bytes', async () => {
  const f = fixture(); f.loseUpload();
  await assert.rejects(f.connector.transfer(spec, checkpoint, f.read, signal()));
  assert.equal((await f.connector.transfer(spec, checkpoint, f.read, signal())).kind, 'accepted');
  assert.equal(f.calls.filter(c => c.url.hostname === 'rupload.facebook.com').length, 1);
});

test('reconciliation and receipt inspection issue only GET requests, including PUBLISHED without a media ID', async () => {
  for (const state of ['IN_PROGRESS', 'FINISHED', 'PUBLISHED', 'ERROR', 'EXPIRED']) {
    const f = fixture(); f.state(state);
    await f.connector.reconcile(spec, checkpoint, signal());
    const result = await f.connector.inspect(spec, receipt, signal());
    assert.ok(f.calls.every(c => c.method === 'GET'));
    assert.equal(result.state, ({ IN_PROGRESS: 'processing', FINISHED: 'staged', PUBLISHED: 'published', ERROR: 'failed', EXPIRED: 'failed' })[state]);
    assert.ok(!('mediaId' in (result.receipt as object)));
  }
});

test('account mismatch prevents creation and final publication without resolving a second credential', async () => {
  const f = fixture(); f.badPage();
  await assert.rejects(f.connector.start(spec, signal()), (e: unknown) => e instanceof PublicationStartError && e.outcome === 'unavailable');
  await assert.rejects(f.connector.publish!(spec, receipt, signal()), (e: unknown) => e instanceof PublicationPublishError && e.outcome === 'unavailable');
  assert.ok(f.calls.every(c => c.method === 'GET'));
});

test('provider upload URL cannot redirect credential-bearing requests', async () => {
  for (const uri of ['https://attacker.invalid/333', 'https://rupload.facebook.com/ig-api-upload/v26.0/444', 'https://rupload.facebook.com/ig-api-upload/v26.0/333?token=extra', 'http://rupload.facebook.com/ig-api-upload/v26.0/333']) {
    const f = fixture(); f.badUri(uri); await assert.rejects(f.connector.start(spec, signal()));
    assert.equal(f.calls.length, 2); assert.ok(f.calls.every(c => c.url.hostname === 'graph.facebook.com'));
  }
});

test('contradictory status, excessive acknowledgement and incomplete complete phase never publish or send bytes', async () => {
  for (const [state, bytes, phase] of [['PUBLISHED', 5, 'in_progress'], ['FINISHED', 5, 'complete'], ['IN_PROGRESS', 11, 'in_progress']] as const) {
    const f = fixture(); f.state(state, bytes, phase);
    await assert.rejects(f.connector.transfer(spec, checkpoint, f.read, signal()));
    await assert.rejects(f.connector.publish!(spec, receipt, signal()));
    assert.ok(f.calls.every(c => c.method === 'GET'));
  }
});

test('wrong receipt destination and unsupported metadata never contact Meta', async () => {
  const f = fixture();
  await assert.rejects(f.connector.inspect(spec, { ...receipt, instagramId: '777' }, signal()));
  await assert.rejects(f.connector.start({ ...spec, metadata: { ...spec.metadata as object, publishAt: '2027-01-01' } }, signal()));
  await assert.rejects(f.connector.start({ ...spec, connectorVersion: '2' }, signal()));
  assert.equal(f.calls.length, 0);
});

test('Stories use their own media type without passing unsupported Reel caption', async () => {
  const f = fixture(); await f.connector.start({ ...spec, metadata: { kind: 'story', isAiGenerated: false } }, signal());
  assert.deepEqual(f.calls[1].body, { media_type: 'STORIES', upload_type: 'resumable', is_ai_generated: false });
});

test('real connector and durable worker recover lost final response by reading original container, with one publish POST', async () => {
  let now = 1000; const store = new PublicationStore(':memory:', () => now), f = fixture();
  const runtime = { async connector() { return f.connector; }, async validateAssets() {}, read: async (_spec: PublicationSpec, asset: number, offset: number, length: number) => f.read(asset, offset, length) };
  try {
    const draft = store.create(spec, 'one'); store.approve('project', draft.id, 1, draft.digest, 'operator');
    await runPublicationStep(store, runtime); await runPublicationStep(store, runtime); f.state('FINISHED');
    assert.equal((await runPublicationStep(store, runtime))?.state, 'staged'); now += 60000;
    f.losePublish(); assert.equal((await runPublicationStep(store, runtime))?.issue, 'publish-unknown');
    now += 120001; assert.equal(await runPublicationStep(store, runtime), null);
    store.reconcile('project', draft.id, 1); const restored = await runPublicationStep(store, runtime);
    assert.equal(restored?.state, 'published'); assert.deepEqual(restored?.receipt, { ...receipt, status: 'PUBLISHED' });
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/media_publish')).length, 1);
  } finally { store.close(); }
});

test('five durable processing observations pause the queue and subsequent reconciliation never publishes', async () => {
  const f = fixture(); let now = 1000;
  const store = new PublicationStore(':memory:', () => now), draft = store.create(spec, 'bounded');
  const runtime = { connector: async () => f.connector, validateAssets: async () => {}, read: async (_spec: PublicationSpec, asset: number, offset: number, length: number) => f.read(asset, offset, length) };
  try {
    store.approve('project', draft.id, 1, draft.digest, 'ui');
    await runPublicationStep(store, runtime); await runPublicationStep(store, runtime);
    for (let i = 1; i <= 5; i++) {
      const result = await runPublicationStep(store, runtime);
      assert.equal(result?.state, i === 5 ? 'uncertain' : 'processing');
      assert.equal((result?.receipt as { processingPolls: number }).processingPolls, i); now += 60001;
    }
    assert.equal(store.get('project', draft.id)?.issue, 'processing-timeout');
    assert.equal(await runPublicationStep(store, runtime), null);
    f.state('FINISHED'); store.reconcile('project', draft.id, 1);
    assert.equal((await runPublicationStep(store, runtime))?.state, 'uncertain');
    assert.equal(store.get('project', draft.id)?.issue, 'publish-unknown');
    assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/media_publish')).length, 0);
  } finally { store.close(); }
});
