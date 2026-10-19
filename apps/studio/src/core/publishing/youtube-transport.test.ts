import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createYouTubeTransport, YOUTUBE_CHUNK_BYTES } from './youtube-transport.server';
import { boundedJson, uploadSessionUrl, YouTubeTransportError } from './youtube-http.server';
import { youtubeMetadataSchema, youtubeResource, type YouTubeMetadata } from './youtube-contract';

const metadata: YouTubeMetadata = { title: 'Local creative — 테스트', description: 'A reviewed export', categoryId: '22', tags: ['creative work'], privacy: 'private', madeForKids: false, containsSyntheticMedia: true, notifySubscribers: false };
const channelId = 'UC-test-channel';
const sessionUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=private-session';
const receipt = { id: 'testVideo01', snippet: { channelId }, status: { privacyStatus: 'private', uploadStatus: 'uploaded' } };
const accounts = { items: [{ id: channelId, snippet: { title: 'Test channel' } }] };
const signal = () => AbortSignal.timeout(10000);
const identity = { sessionUrl, channelId, sizeBytes: 100, contentType: 'video/mp4' as const };
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

test('requires explicit publication choices and validates scheduling and metadata before networking', async () => {
  const { privacy: _, ...missing } = metadata;
  assert.equal(youtubeMetadataSchema.safeParse(missing).success, false);
  assert.throws(() => youtubeResource({ ...metadata, description: '한'.repeat(2000) }), /UTF-8/);
  assert.throws(() => youtubeResource({ ...metadata, tags: ['a'.repeat(499), 'x'] }), /500-character/);
  assert.throws(() => youtubeResource({ ...metadata, privacy: 'public', publishAt: '2099-01-01T00:00:00Z' }), /private/);
  assert.throws(() => youtubeResource({ ...metadata, publishAt: '2000-01-01T00:00:00Z' }), /future/);
  let calls = 0;
  const transport = createYouTubeTransport({ accessToken: async () => 'test-token', fetch: async () => { calls++; return json(accounts); } });
  await assert.rejects(transport.startSession({ ...identity, metadata: { ...metadata, title: '' } }, signal()));
  assert.equal(calls, 0);
});

test('uses the same credential for verified channel and session creation, with explicit privacy and notifications', async () => {
  let credentials = 0; const requests: { url: string; init: RequestInit }[] = [];
  const transport = createYouTubeTransport({ accessToken: async () => `token-${++credentials}`, fetch: async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return init?.method === 'GET' ? json(accounts) : new Response(null, { status: 200, headers: { location: sessionUrl } });
  } });
  assert.deepEqual(await transport.startSession({ ...identity, metadata }, signal()), { sessionUrl });
  assert.equal(credentials, 1);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(new Headers(request.init.headers).get('authorization'), 'Bearer token-1');
    assert.equal(request.init.redirect, 'manual'); assert.equal(request.init.credentials, 'omit');
  }
  assert.equal(new URL(requests[1].url).searchParams.get('notifySubscribers'), 'false');
  const body = JSON.parse(String(requests[1].init.body));
  assert.deepEqual(body.status, { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
  assert.equal(body.snippet.title, metadata.title);
});

test('does not start an upload for a wrong or ambiguous OAuth channel', async () => {
  for (const items of [[{ id: 'wrong', snippet: { title: 'Wrong' } }], [...accounts.items, ...accounts.items]]) {
    let posts = 0;
    const transport = createYouTubeTransport({ accessToken: async () => 'token', fetch: async (_url, init) => { if (init?.method === 'POST') posts++; return json({ items }); } });
    await assert.rejects(transport.startSession({ ...identity, metadata }, signal()), error => error instanceof YouTubeTransportError && error.outcome === 'rejected');
    assert.equal(posts, 0);
  }
});

test('rechecks scheduled time after account lookup and rejects invalid chunks before upload', async () => {
  let clock = Date.parse('2030-01-01T00:00:00Z'), calls = 0;
  const transport = createYouTubeTransport({ now: () => clock, accessToken: async () => 'token', fetch: async () => { calls++; clock += 60000; return json(accounts); } });
  await assert.rejects(transport.startSession({ ...identity, metadata: { ...metadata, publishAt: '2030-01-01T00:00:30Z' } }, signal()), /future/);
  assert.equal(calls, 1);
  for (const [offset, length] of [[-1, 100], [0, 0], [0, 101], [100, 1]]) await assert.rejects(transport.sendChunk(identity, offset, new Uint8Array(length), signal()), /Invalid upload chunk/);
  await assert.rejects(transport.sendChunk({ ...identity, sizeBytes: YOUTUBE_CHUNK_BYTES * 2 }, 0, new Uint8Array(100), signal()), /fixed chunk size/);
  assert.equal(calls, 1);
});

test('rejects foreign session URLs without echoing their credentials or sending any request', async () => {
  for (const url of ['https://attacker.example/upload?upload_id=secret', 'http://www.googleapis.com/upload/youtube/v3/videos?upload_id=secret', 'https://user:secret@www.googleapis.com/upload/youtube/v3/videos?upload_id=x', 'https://www.googleapis.com/other?upload_id=secret']) {
    assert.throws(() => uploadSessionUrl(url), error => error instanceof Error && !error.message.includes('secret'));
    let calls = 0;
    const transport = createYouTubeTransport({ accessToken: async () => 'token', fetch: async () => { calls++; return json({}); } });
    await assert.rejects(transport.probe({ ...identity, sessionUrl: url }, signal()));
    assert.equal(calls, 0);
  }
});

test('distinguishes expired sessions, incomplete ranges, malformed acknowledgements and completed upload receipts', async () => {
  const replies = [new Response(null, { status: 404 }), new Response(null, { status: 308 }), new Response(null, { status: 308, headers: { range: 'bytes=0-49', 'retry-after': '2' } }), new Response(null, { status: 308, headers: { range: 'bytes=0-100' } }), json(receipt, 201)];
  const transport = createYouTubeTransport({ accessToken: async () => 'token', fetch: async () => replies.shift()! });
  assert.deepEqual(await transport.probe(identity, signal()), { kind: 'expired' });
  assert.deepEqual(await transport.probe(identity, signal()), { kind: 'incomplete', nextByte: 0, retryAfterMs: null });
  assert.deepEqual(await transport.probe(identity, signal()), { kind: 'incomplete', nextByte: 50, retryAfterMs: 2000 });
  await assert.rejects(transport.probe(identity, signal()), /inconsistent/);
  const accepted = await transport.probe(identity, signal());
  assert.equal(accepted.kind, 'accepted');
  if (accepted.kind === 'accepted') { assert.equal(accepted.receipt.uploadStatus, 'uploaded'); assert.equal(accepted.receipt.privacy, 'private'); }
});

test('unknown final acknowledgement and foreign receipts never imply a new upload or public success', async () => {
  for (const response of [new Response(null, { status: 503, headers: { 'retry-after': '7' } }), json({ ...receipt, snippet: { channelId: 'wrong' } }, 201), new Response(null, { status: 302, headers: { location: 'https://attacker.example/' } })]) {
    let calls = 0;
    const transport = createYouTubeTransport({ accessToken: async () => 'token', fetch: async () => { calls++; return response; } });
    await assert.rejects(transport.sendChunk(identity, 0, new Uint8Array(100), signal()), error => error instanceof YouTubeTransportError && error.outcome === 'unknown');
    assert.equal(calls, 1);
  }
});

test('session creation rejection versus lost acknowledgement preserves uncertainty without implicit retries', async () => {
  for (const status of [403, 503]) {
    let posts = 0;
    const transport = createYouTubeTransport({ accessToken: async () => 'hidden-token', fetch: async (_url, init) => {
      if (init?.method === 'GET') return json(accounts);
      posts++; return new Response('private response hidden-token', { status });
    } });
    await assert.rejects(transport.startSession({ ...identity, metadata }, signal()), error => error instanceof YouTubeTransportError && error.outcome === (status === 403 ? 'rejected' : 'unknown') && !error.message.includes('hidden-token'));
    assert.equal(posts, 1);
  }
});

test('bounded JSON cancels oversized and stalled responses', async () => {
  await assert.rejects(boundedJson(new Response('x'.repeat(65537)), signal()), /byte limit/);
  const controller = new AbortController(); let canceled = false;
  const body = new ReadableStream({ pull() {}, cancel() { canceled = true; } });
  const pending = boundedJson(new Response(body), controller.signal);
  const failed = assert.rejects(pending, /test abort/); controller.abort(new Error('test abort'));
  await failed; assert.equal(canceled, true);
});

test('real HTTP bytes recover partial and lost final responses through one session', async () => {
  const source = Buffer.alloc(YOUTUBE_CHUNK_BYTES * 2 + 3, 0xa5), accepted: Buffer[] = [];
  let nextByte = 0, posts = 0, droppedFirst = false, droppedFinal = false;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://local');
    const reply = (value: unknown, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (url.pathname === '/youtube/v3/channels') { reply(accounts); return; }
    if (request.method === 'POST') { posts++; request.resume(); response.writeHead(200, { location: sessionUrl }); response.end(); return; }
    if (request.method === 'GET') { reply({ items: [{ ...receipt, status: { ...receipt.status, uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' } }] }); return; }
    const range = request.headers['content-range'];
    if (range === `bytes */${source.length}`) {
      if (nextByte === source.length) reply(receipt, 201);
      else { response.writeHead(308, nextByte ? { range: `bytes=0-${nextByte - 1}` } : {}); response.end(); }
      return;
    }
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(range));
    if (!match || Number(match[1]) !== nextByte || Number(match[3]) !== source.length) { response.writeHead(400); response.end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks);
    assert.equal(body.length, Number(match[2]) - nextByte + 1);
    if (!droppedFirst) { droppedFirst = true; accepted.push(body.subarray(0, body.length / 2)); nextByte += body.length / 2; request.socket.destroy(); return; }
    accepted.push(body); nextByte += body.length;
    if (nextByte === source.length && !droppedFinal) { droppedFinal = true; request.socket.destroy(); return; }
    response.writeHead(308, { range: `bytes=0-${nextByte - 1}` }); response.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const transport = createYouTubeTransport({ accessToken: async () => 'fixture-token', fetch: (url, init) => {
    const remote = new URL(String(url)); return fetch(`http://127.0.0.1:${address.port}${remote.pathname}${remote.search}`, init);
  } });
  try {
    const started = await transport.startSession({ ...identity, sizeBytes: source.length, metadata }, signal());
    const upload = { ...identity, ...started, sizeBytes: source.length };
    await assert.rejects(transport.sendChunk(upload, 0, source.subarray(0, YOUTUBE_CHUNK_BYTES), signal()), /without a confirmed/);
    const partial = await transport.probe(upload, signal()); assert.equal(partial.kind, 'incomplete');
    assert.ok(partial.kind === 'incomplete'); assert.equal(partial.nextByte, YOUTUBE_CHUNK_BYTES / 2);
    const middle = await transport.sendChunk(upload, partial.nextByte, source.subarray(partial.nextByte, partial.nextByte + YOUTUBE_CHUNK_BYTES), signal()); assert.ok(middle.kind === 'incomplete');
    await assert.rejects(transport.sendChunk(upload, middle.nextByte, source.subarray(middle.nextByte), signal()), /without a confirmed/);
    assert.equal((await transport.probe(upload, signal())).kind, 'accepted');
    const inspected = await transport.inspectVideo(receipt.id, channelId, signal()); assert.equal(inspected.processingStatus, 'succeeded'); assert.equal(inspected.privacy, 'private');
    assert.equal(posts, 1); assert.equal(nextByte, source.length);
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex'); assert.equal(hash(Buffer.concat(accepted)), hash(source));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
