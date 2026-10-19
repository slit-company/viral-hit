import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInstagramTransport, INSTAGRAM_READ_BYTES } from './instagram-transport.server';
import { instagramJson } from './instagram-http.server';

const credential = async () => ({ instagramId: '222', pageId: '111', accessToken: 'test-only-token' });
const target = { containerId: '333', instagramId: '222', pageId: '111', sizeBytes: INSTAGRAM_READ_BYTES + 23 };
const signal = () => new AbortController().signal;

test('native fetch streams a resumed upload through a real HTTP socket with exact length and offset headers', async () => {
  let bytes = 13, requests = 0;
  const server = createServer(async (request, response) => {
    requests++;
    if (request.url === '/v26.0/111?fields=id,instagram_business_account') {
      assert.equal(request.headers.authorization, 'Bearer test-only-token');
      response.end(JSON.stringify({ id: '111', instagram_business_account: { id: '222' } }));
    } else if (request.url === '/v26.0/333?fields=id,status_code,video_status') {
      response.end(JSON.stringify({ id: '333', status_code: 'IN_PROGRESS', video_status: { uploading_phase: { status: bytes === target.sizeBytes ? 'complete' : 'in_progress', bytes_transferred: bytes } } }));
    } else {
      assert.equal(request.method, 'POST'); assert.equal(request.url, '/ig-api-upload/v26.0/333');
      assert.equal(request.headers.offset, '13'); assert.equal(request.headers.file_size, String(target.sizeBytes));
      assert.equal(request.headers['content-length'], String(target.sizeBytes - 13));
      assert.equal(request.headers.authorization, 'OAuth test-only-token');
      for await (const chunk of request) { assert.ok(Buffer.from(chunk).every(b => b === 77)); bytes += chunk.length; }
      response.end(JSON.stringify({ success: true }));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const client = createInstagramTransport({ credential, fetch: (input, init) => { const url = new URL(String(input)); return fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init); } });
  const reads: [number, number][] = [];
  try {
    const result = await client.upload(target, async (offset, length) => { reads.push([offset, length]); return new Uint8Array(length).fill(77); }, signal());
    assert.equal(result.upload?.status, 'complete'); assert.equal(bytes, target.sizeBytes); assert.equal(requests, 4);
    assert.deepEqual(reads, [[13, INSTAGRAM_READ_BYTES], [13 + INSTAGRAM_READ_BYTES, 10]]);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('aborting a pending media read prevents later byte enqueue and further media reads', async () => {
  const abort = new AbortController(); let reads = 0, consumed = 0;
  const client = createInstagramTransport({ credential, fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/111')) return Response.json({ id: '111', instagram_business_account: { id: '222' } });
    if (url.hostname === 'graph.facebook.com') return Response.json({ id: '333', status_code: 'IN_PROGRESS', video_status: { uploading_phase: { status: 'in_progress', bytes_transferred: 0 } } });
    const reader = (init!.body as ReadableStream<Uint8Array>).getReader();
    try { while (true) { const value = await reader.read(); if (value.done) break; consumed += value.value.length; } }
    finally { reader.releaseLock(); }
    return Response.json({ success: true });
  } });
  await assert.rejects(client.upload(target, async (_offset, length) => { reads++; abort.abort(); return new Uint8Array(length); }, abort.signal));
  assert.equal(reads, 1); assert.equal(consumed, 0);
});

test('empty, oversized, rejected or malformed provider bodies are bounded and do not escape in errors', async () => {
  for (const response of [new Response(null), new Response('sensitive-provider-body'), new Response('x'.repeat(65537)), Response.json({ message: 'sensitive-provider-body' }, { status: 403 })]) {
    await assert.rejects(instagramJson(response, signal()), error => error instanceof Error && error.message === 'Instagram request could not be verified');
  }
});
