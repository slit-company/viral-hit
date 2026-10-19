import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAdapter, VERSION } from '../src/adapter.mjs';

const input = { provider: 'api', model: 'gpt-5.4', prompt: 'An orange kite', quality: 'medium', size: '1024x1024' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
const signal = AbortSignal.timeout(30000);

async function fixture(fn) {
  const state = { calls: [], mode: 'active', request: null, imagePatch: {}, terminalStatus: 'completed' };
  const server = createServer(async (req, res) => {
    state.calls.push({ method: req.method, url: req.url, token: req.headers['x-ima2-token'] });
    res.setHeader('Content-Type', 'application/json');
    const json = value => res.end(JSON.stringify(value));
    if (req.url === '/api/health') return json({ ok: true, version: state.version ?? VERSION });
    if (req.url === '/api/generate') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      state.request = JSON.parse(Buffer.concat(chunks));
      assert.equal(req.headers['idempotency-key'], state.request.requestId);
      if (state.drop) return req.socket.destroy();
      res.statusCode = 202; return json({ requestId: state.wrongId ? 'wrong' : state.request.requestId, async: true });
    }
    if (req.url.startsWith('/api/history?')) return json({ items: state.mode === 'image' ? [{
      requestId: state.request.requestId, filename: '2026-10-20/image.png', kind: 'classic', mediaType: 'image',
      provider: input.provider, model: input.model, prompt: state.request.prompt, refsCount: state.request.references.length,
      ...state.imagePatch,
    }] : [] });
    if (req.url === '/api/inflight?includeTerminal=1') {
      const job = state.request ? { requestId: state.request.requestId, kind: 'classic', prompt: state.request.prompt.slice(0, 500),
        meta: { model: input.model, refsCount: state.request.references.length } } : null;
      return json({ jobs: state.mode === 'active' && job ? [job] : [], terminalJobs: state.mode === 'terminal' && job
        ? [{ ...job, prompt: undefined, status: state.terminalStatus, finishedAt: state.finishedAt ?? Date.now() }] : [] });
    }
    if (req.method === 'DELETE') return json({ aborted: true });
    if (req.url === '/generated/2026-10-20/image.png') {
      if (state.redirect) { res.writeHead(302, { Location: 'http://127.0.0.1:1/private' }); return res.end(); }
      res.setHeader('Content-Type', 'image/png');
      if (state.oversized) res.setHeader('Content-Length', 33 * 1024 * 1024);
      return res.end(state.badBytes ? 'not an image' : png);
    }
    res.statusCode = 404; json({ error: 'missing' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { VIRAL_HIT_IMA2_URL: `http://127.0.0.1:${server.address().port}`, VIRAL_HIT_IMA2_TOKEN: 'test-token' };
  let saved = null;
  const context = { key: 'durable-job-key', signal, readAsset: async () => ({ bytes: png }), readBinary: async () => saved,
    publishBinary: async (bytes, details) => { assert.deepEqual(bytes, png); saved = { binaryReceipt: { id: 'receipt' }, ...details }; return saved; } };
  try { await fn({ adapter: createAdapter({ env }), state, env, context }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('explicit lane/model, async submission and immutable image receipt', () => fixture(async ({ adapter, state, context }) => {
  const { id } = await adapter.submit(input, context);
  assert.match(id, /^vh_[a-f0-9]{64}$/);
  assert.equal(state.request.provider, 'api'); assert.equal(state.request.model, 'gpt-5.4');
  assert.equal(state.request.n, 1); assert.equal(state.request.webSearchEnabled, false);
  assert.equal((await adapter.poll(id, input, signal, context)).state, 'running');
  state.mode = 'image';
  const result = await adapter.poll(id, input, signal, context);
  assert.equal(result.state, 'succeeded'); assert.equal(result.output.creditsUsed, null);
  assert.equal(result.output.providerJobId, id); assert.equal(result.output.model, 'ima2/api/gpt-5.4');
  assert.equal(result.output.contentType, 'image/png');
  const count = state.calls.length;
  await adapter.poll(id, input, signal, context);
  assert.equal(state.calls.length, count, 'saved bytes require no remote calls');
  assert.ok(state.calls.every(call => call.token === 'test-token'));
}));

test('reference generation sends the pinned image bytes', () => fixture(async ({ adapter, state, context }) => {
  await adapter.submit({ ...input, source: 'project-image' }, context);
  assert.equal(state.request.references[0], `data:image/png;base64,${png.toString('base64')}`);
}));

test('long directions match the upstream 500-character active-job preview and full saved prompt', () => fixture(async ({ adapter, state, context }) => {
  const long = { ...input, prompt: 'A detailed creative direction. '.repeat(40) };
  const { id } = await adapter.submit(long, context);
  assert.equal((await adapter.poll(id, long, signal, context)).state, 'running');
  state.mode = 'image';
  assert.equal((await adapter.poll(id, long, signal, context)).state, 'succeeded');
}));

test('lost POST response is recovered read-only without consulting an idempotency cache', () => fixture(async ({ adapter, state, context }) => {
  state.drop = true;
  await assert.rejects(adapter.submit(input, context));
  state.mode = 'image';
  const recovered = await adapter.reconcile(input, context);
  assert.equal(recovered.id, state.request.requestId);
  assert.equal((await adapter.poll(recovered.id, input, signal, context)).state, 'succeeded');
  assert.equal(state.calls.filter(call => call.method === 'POST').length, 1);
  // Recovery never consults or renews the upstream idempotency key.
  assert.ok(state.calls.slice(2).every(call => call.method === 'GET'));
}));

test('missing/expired tracking cannot resubmit a paid job', () => fixture(async ({ adapter, state, context }) => {
  const { id } = await adapter.submit(input, context); state.mode = 'missing';
  assert.equal(await adapter.reconcile(input, context), null);
  assert.equal((await adapter.poll(id, input, signal, context)).state, 'uncertain');
  assert.equal(state.calls.filter(call => call.method === 'POST').length, 1);
}));

test('cancellation acknowledgement is followed by observed terminal state', () => fixture(async ({ adapter, state, context }) => {
  const { id } = await adapter.submit(input, context);
  assert.equal(await adapter.cancel(id, input, signal), undefined);
  assert.equal((await adapter.poll(id, input, signal, context)).state, 'running');
  state.mode = 'terminal'; state.terminalStatus = 'canceled';
  assert.equal((await adapter.poll(id, input, signal, context)).state, 'canceled');
}));

test('completed history cache lag waits briefly; unavailable retained output becomes uncertain', () => fixture(async ({ adapter, state, context }) => {
  const { id } = await adapter.submit(input, context); state.mode = 'terminal';
  assert.equal((await adapter.poll(id, input, signal, context)).state, 'running');
  state.finishedAt = Date.now() - 60000;
  assert.equal((await adapter.poll(id, input, signal, context)).state, 'uncertain');
}));

for (const imagePatch of [{ provider: 'oauth' }, { model: 'another' }, { requestId: 'another' }, { refsCount: 2 }, { filename: '../secrets.png' }, { filename: 'https://elsewhere/image.png' }]) {
  test(`refuse mismatched or unsafe result ${JSON.stringify(imagePatch)}`, () => fixture(async ({ adapter, state, context }) => {
    const { id } = await adapter.submit(input, context); state.mode = 'image'; state.imagePatch = imagePatch;
    await assert.rejects(adapter.poll(id, input, signal, context));
    assert.ok(!state.calls.some(call => call.url.startsWith('/generated/')));
  }));
}

for (const flag of ['redirect', 'oversized', 'badBytes']) {
  test(`refuse ${flag} binary response`, () => fixture(async ({ adapter, state, context }) => {
    const { id } = await adapter.submit(input, context); state.mode = 'image'; state[flag] = true;
    await assert.rejects(adapter.poll(id, input, signal, context));
    assert.equal(await context.readBinary(), null);
  }));
}

test('unsupported version and automatic provider cannot reach generation', () => fixture(async ({ adapter, state, context }) => {
  state.version = 'future'; await assert.rejects(adapter.submit(input, context), /requires/);
  await assert.rejects(adapter.submit({ ...input, provider: 'auto' }, context), /Invalid/);
  assert.ok(state.calls.every(call => call.method === 'GET'));
}));

test('remote plaintext and URL credentials are rejected before fetch', async () => {
  for (const url of ['http://192.0.2.1', 'https://user:secret@example.org', 'https://example.org/api']) {
    const adapter = createAdapter({ env: { VIRAL_HIT_IMA2_URL: url }, fetcher: () => assert.fail('must not fetch') });
    await assert.rejects(adapter.submit(input, { key: 'x', signal }));
  }
});
