import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PublicationStore } from './store.server';
import { runPublicationStep, type PublicationRuntime } from './worker.server';
import { createYouTubeConnector } from './youtube-connector.server';
import { YOUTUBE_CHUNK_BYTES } from './youtube-transport.server';
import { PublicationStartError, type PublicationSpec } from './contracts';

const metadata = { title: 'Reviewed export', description: '', categoryId: '22', tags: [], privacy: 'private', madeForKids: false, containsSyntheticMedia: true, notifySubscribers: false };
const spec: PublicationSpec = {
  schemaVersion: 1, projectId: 'project', connector: 'youtube', connectorVersion: '1', accountId: 'account', destinationId: 'channel',
  assets: [{ assetId: 'asset', sha256: 'a'.repeat(64), sizeBytes: 10, contentType: 'video/mp4' }], metadata,
};
const sessionUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=original';
const checkpoint = { sessionUrl, nextByte: 0 };
const receipt = { videoId: 'testVideo01', channelId: 'channel', privacy: 'private', uploadStatus: 'uploaded' };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const resource = (status: Record<string, string> = {}, processingStatus?: string) => ({ id: receipt.videoId, snippet: { channelId: 'channel' }, status: { privacyStatus: 'private', uploadStatus: 'uploaded', ...status }, ...(processingStatus ? { processingDetails: { processingStatus } } : {}) });
const signal = () => AbortSignal.timeout(10000);

test('SQLite reopen plus connector recovers partial and lost final acknowledgements with one session creation', async () => {
  const bytes = Buffer.alloc(YOUTUBE_CHUNK_BYTES + 123, 0x7a), received = Buffer.alloc(bytes.length);
  const input = { ...spec, assets: [{ ...spec.assets[0], sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] };
  const dir = mkdtempSync(join(tmpdir(), 'publication-youtube-')), file = join(dir, 'jobs.sqlite');
  let now = 1000, accepted = 0, starts = 0, writes = 0, probes = 0, mediaReads = 0;
  let store = new PublicationStore(file, () => now);
  const connector = createYouTubeConnector({ accessToken: async account => { assert.equal(account, 'account'); return 'fixture-token'; }, fetch: async (raw, init) => {
    const url = String(raw), method = init?.method;
    if (url.includes('/channels?')) return json({ items: [{ id: 'channel', snippet: { title: 'Fixture channel' } }] });
    if (method === 'POST') { starts++; return new Response(null, { headers: { location: sessionUrl } }); }
    if (method === 'PUT') {
      assert.equal(url, sessionUrl);
      const range = new Headers(init?.headers).get('content-range')!;
      if (range.startsWith('bytes */')) {
        probes++;
        return accepted === bytes.length ? json(resource()) : new Response(null, { status: 308, headers: accepted ? { range: `bytes=0-${accepted - 1}` } : {} });
      }
      writes++; const start = Number(/^bytes (\d+)-/.exec(range)![1]);
      assert.equal(start, accepted);
      const body = init?.body as Uint8Array;
      const count = writes === 1 ? Math.floor(body.length / 2) : body.length;
      received.set(body.subarray(0, count), start); accepted += count;
      throw new Error('Simulated socket loss after remote byte acceptance');
    }
    return json({ items: [resource({ uploadStatus: 'processed' }, 'succeeded')] });
  } });
  const runtime: PublicationRuntime = {
    connector: async () => connector,
    validateAssets: async pinned => { assert.equal(createHash('sha256').update(bytes).digest('hex'), pinned.assets[0].sha256); },
    read: async (_spec, index, offset, length) => { mediaReads++; assert.equal(index, 0); assert.ok(length <= YOUTUBE_CHUNK_BYTES); return bytes.subarray(offset, offset + length); },
  };
  try {
    const draft = store.create(input, 'one'); store.approve('project', draft.id, 1, draft.digest, 'operator');
    assert.equal((await runPublicationStep(store, runtime))?.state, 'uploading');
    assert.equal(writes, 0);
    for (let step = 0; step < 4; step++) {
      store.close(); store = new PublicationStore(file, () => now); now += 120001;
      await runPublicationStep(store, runtime);
    }
    assert.equal(store.get('project', draft.id)?.state, 'ready');
    assert.equal(starts, 1); assert.equal(writes, 2); assert.equal(probes, 3); assert.equal(mediaReads, 2);
    assert.equal(createHash('sha256').update(received).digest('hex'), input.assets[0].sha256);
    assert.equal(await runPublicationStep(store, runtime), null);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('read-only reconciliation probes original identity without reading or transmitting media', async () => {
  let calls = 0;
  const connector = createYouTubeConnector({ accessToken: async () => 'token', fetch: async (_url, init) => {
    calls++; assert.equal(init?.method, 'PUT'); assert.equal(new Headers(init?.headers).get('content-range'), 'bytes */10');
    assert.equal((init?.body as Uint8Array).length, 0);
    return new Response(null, { status: 308, headers: { range: 'bytes=0-4' } });
  } });
  assert.deepEqual(await connector.reconcile(spec, checkpoint, signal()), { kind: 'progress', checkpoint: { sessionUrl, nextByte: 5 }, retryAfterMs: 0 });
  assert.equal(calls, 1);
});

test('all bytes acknowledged without a receipt and provider backoff do not send another body', async () => {
  const responses: Record<string, string>[] = [{ range: 'bytes=0-9' }, { 'retry-after': '60' }];
  for (const headers of responses) {
    let reads = 0;
    const connector = createYouTubeConnector({ accessToken: async () => 'token', fetch: async () => new Response(null, { status: 308, headers }) });
    const observation = await connector.transfer(spec, checkpoint, async () => { reads++; return new Uint8Array(0); }, signal());
    assert.equal(reads, 0); assert.equal(observation.kind, 'progress');
    if (observation.kind === 'progress') assert.ok(observation.retryAfterMs! >= 30000);
  }
});

test('acceptance, processing, ready, scheduled, published and rejected are not conflated', async () => {
  const cases: (Record<string, string> & { expected: string })[] = [
    { uploadStatus: 'uploaded', privacyStatus: 'public', expected: 'processing' },
    { uploadStatus: 'processed', privacyStatus: 'private', expected: 'ready' },
    { uploadStatus: 'processed', privacyStatus: 'unlisted', expected: 'ready' },
    { uploadStatus: 'processed', privacyStatus: 'private', publishAt: '2000-01-01T00:00:00Z', expected: 'scheduled' },
    { uploadStatus: 'processed', privacyStatus: 'public', expected: 'published' },
    { uploadStatus: 'rejected', privacyStatus: 'private', expected: 'failed' },
  ];
  for (const { expected, ...status } of cases) {
    const connector = createYouTubeConnector({ accessToken: async () => 'token', fetch: async () => json({ items: [resource(status)] }) });
    assert.equal((await connector.inspect(spec, receipt, signal())).state, expected);
  }
  for (const processing of ['failed', 'terminated', 'processing']) {
    const connector = createYouTubeConnector({ accessToken: async () => 'token', fetch: async () => json({ items: [resource({ uploadStatus: 'processed', privacyStatus: 'public' }, processing)] }) });
    assert.equal((await connector.inspect(spec, receipt, signal())).state, processing === 'processing' ? 'processing' : 'failed');
  }
});

test('unsupported inputs and foreign receipts/checkpoints fail before any remote request', async () => {
  let calls = 0;
  const connector = createYouTubeConnector({ accessToken: async () => 'token', fetch: async () => { calls++; throw new Error('Unexpected request'); } });
  for (const change of [{ connectorVersion: '2' }, { assets: [...spec.assets, ...spec.assets] }, { metadata: { ...metadata, publishAt: '2000-01-01T00:00:00Z' } }]) {
    await assert.rejects(connector.start({ ...spec, ...change }, signal()), error => error instanceof PublicationStartError && error.outcome === 'rejected');
  }
  await assert.rejects(connector.inspect(spec, { ...receipt, channelId: 'another-channel' }, signal()));
  await assert.rejects(connector.reconcile(spec, { sessionUrl: 'https://attacker.invalid', nextByte: 0 }, signal()));
  assert.equal(calls, 0);
});
