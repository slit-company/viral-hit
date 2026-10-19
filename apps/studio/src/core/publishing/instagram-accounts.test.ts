import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInstagramAccounts, openInstagramAccountManagement } from './instagram-accounts.server';
import { createMetaOAuth, metaOAuthConfig } from './meta-oauth.server';
import { PublicationAccountError } from './account-contract';
import { createMetaFixture } from '../../../tests/support/meta-fixture';
import { createInstagramAccountHttp } from '../../routes/api/app/publishing/-instagram-account-http.server';

const config = { clientId: '123', clientSecret: 'private-meta-secret', configurationId: '456', redirectUri: 'http://127.0.0.1:3808/api/app/publishing/instagram/callback' };
const binding = 'a'.repeat(43), signal = () => new AbortController().signal;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vh-instagram-accounts-')); let now = 1800000000000;
  const remote = createMetaFixture(() => now), options = { root, config, now: () => now, fetch: remote.request };
  let service = openInstagramAccounts(options);
  async function begin(reconnect?: { accountId: string; revision: number }) {
    const started = service.begin(binding, reconnect), state = new URL(started.authorizationUrl).searchParams.get('state')!;
    const callback = new URL(config.redirectUri); callback.search = new URLSearchParams({ state, code: 'private-code' }).toString();
    return { started, state, callback };
  }
  return { root, remote, options, get service() { return service; }, begin, tick: (ms: number) => { now += ms; },
    reopen: () => { service.close(); service = openInstagramAccounts(options); },
    cleanup: () => { service.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('Meta code flow stages encrypted choices; explicit Page selection alone connects an account and survives restart', async () => {
  const f = fixture();
  try {
    const flow = await f.begin(), url = new URL(flow.started.authorizationUrl);
    assert.equal(url.searchParams.get('response_type'), 'code'); assert.equal(url.searchParams.get('config_id'), '456'); assert.equal(url.searchParams.has('scope'), false); assert.equal(f.remote.calls.length, 0);
    await f.service.complete(flow.callback, binding, signal());
    assert.equal(f.service.list().length, 0);
    const selection = f.service.selection(flow.state, binding); assert.equal(selection.candidates.length, 2);
    assert.doesNotMatch(JSON.stringify(selection), /fixture-meta|accessToken|userId|private-code/);
    f.reopen(); assert.equal(f.service.selection(flow.state, binding).candidates.length, 2);
    const account = await f.service.select(flow.state, binding, '112', signal()); assert.equal(account.instagramId, '223'); assert.equal(account.pageId, '112'); assert.equal(account.status, 'connected');
    assert.throws(() => f.service.selection(flow.state, binding), /invalid-callback/);
    f.reopen(); assert.deepEqual(f.service.get(account.id), account);
    const database = readFileSync(join(f.root, 'accounts.sqlite')); assert.ok(!database.includes(Buffer.from('fixture-meta-page-112')));
    assert.ok(!database.includes(Buffer.from('private-meta-secret')));
    assert.equal(f.remote.calls.filter(c => c.path.endsWith('/oauth/access_token')).length, 2);
    assert.ok(f.remote.calls.every(c => !c.path.includes('media')));
  } finally { f.cleanup(); }
});

test('wrong browser, duplicate callback and expired selection cannot reuse grants', async () => {
  const f = fixture();
  try {
    const flow = await f.begin();
    await assert.rejects(f.service.complete(flow.callback, 'b'.repeat(43), signal()), /invalid-callback/); assert.equal(f.remote.calls.length, 0);
    await f.service.complete(flow.callback, binding, signal()); const calls = f.remote.calls.length;
    await assert.rejects(f.service.complete(flow.callback, binding, signal()), /invalid-callback/); assert.equal(f.remote.calls.length, calls);
    assert.throws(() => f.service.selection(flow.state, 'b'.repeat(43)), /invalid-callback/);
    f.tick(300001); await assert.rejects(f.service.select(flow.state, binding, '111', signal()), /invalid-callback/); assert.equal(f.remote.calls.length, calls);
  } finally { f.cleanup(); }
});

test('missing publish permission, wrong app and revoked tokens never produce selectable accounts', async () => {
  for (const failure of ['scope', 'app', 'revoked']) {
    const f = fixture();
    try {
      if (failure === 'scope') f.remote.removeScope(); else if (failure === 'app') f.remote.wrongApp(); else f.remote.revoke();
      const flow = await f.begin();
      await assert.rejects(f.service.complete(flow.callback, binding, signal()), (error: unknown) => error instanceof PublicationAccountError && error.code === ({ scope: 'scope-missing', app: 'identity-mismatch', revoked: 'grant-rejected' })[failure]);
      assert.equal(f.service.list().length, 0); assert.throws(() => f.service.selection(flow.state, binding), /invalid-callback/);
    } finally { f.cleanup(); }
  }
});

test('selected destination is verified again, and rejected or canceled choices cannot create a connection', async () => {
  const f = fixture();
  try {
    const flow = await f.begin(); await f.service.complete(flow.callback, binding, signal());
    await assert.rejects(f.service.select(flow.state, binding, '777', signal()), /invalid-callback/);
    f.remote.changeDestination('999'); await assert.rejects(f.service.select(flow.state, binding, '111', signal()), /identity-mismatch/); assert.equal(f.service.list().length, 0);
    const canceled = await f.begin(); await f.service.complete(canceled.callback, binding, signal()); f.service.cancel(canceled.state, binding);
    await assert.rejects(f.service.select(canceled.state, binding, '112', signal()), /invalid-callback/);
  } finally { f.cleanup(); }
});

test('reconnect keeps Page and Instagram identity; disconnect invalidates pending callbacks and selections', async () => {
  const f = fixture();
  try {
    const first = await f.begin(); await f.service.complete(first.callback, binding, signal()); const account = await f.service.select(first.state, binding, '111', signal());
    const reconnect = await f.begin({ accountId: account.id, revision: 1 }); await f.service.complete(reconnect.callback, binding, signal());
    assert.deepEqual(f.service.selection(reconnect.state, binding).candidates.map(c => c.pageId), ['111']);
    const pending = await f.begin({ accountId: account.id, revision: 1 });
    const local = openInstagramAccountManagement({ root: f.root });
    try { assert.equal(local.disconnect(account.id, 1).status, 'disconnected'); } finally { local.close(); }
    await assert.rejects(f.service.select(reconnect.state, binding, '111', signal()), /invalid-callback/);
    await assert.rejects(f.service.complete(pending.callback, binding, signal()), /invalid-callback/);
    assert.throws(() => f.service.disconnect(account.id, 1), /invalid-callback/);
    const renewed = await f.begin({ accountId: account.id, revision: 2 }); await f.service.complete(renewed.callback, binding, signal());
    assert.equal((await f.service.select(renewed.state, binding, '111', signal())).revision, 3);
  } finally { f.cleanup(); }
});

test('disconnect while selection verification is in flight fences its late result', async () => {
  const f = fixture();
  try {
    const first = await f.begin(); await f.service.complete(first.callback, binding, signal()); const account = await f.service.select(first.state, binding, '111', signal());
    const next = await f.begin({ accountId: account.id, revision: 1 }); await f.service.complete(next.callback, binding, signal());
    let release!: () => void, entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    f.remote.beforePage(async () => { entered(); await gate; });
    const selecting = f.service.select(next.state, binding, '111', signal()); await started;
    f.service.disconnect(account.id, 1); release(); await assert.rejects(selecting, /invalid-callback/);
    assert.equal(f.service.get(account.id)?.status, 'disconnected');
  } finally { f.cleanup(); }
});

test('callback validation rejects untrusted origin, duplicate code, fragments and denied consent before token exchange', async () => {
  const remote = createMetaFixture(), oauth = createMetaOAuth(config, { fetch: remote.request });
  const { state } = oauth.begin();
  for (const url of [`${config.redirectUri}?state=${state}&code=a&code=b`, `${config.redirectUri}?state=${state}&code=a#token`, `https://attacker.invalid/callback?state=${state}&code=a`, `${config.redirectUri}?state=${state}&error=access_denied`]) await assert.rejects(oauth.exchange(new URL(url), state, signal()));
  assert.equal(remote.calls.length, 0);
  for (const redirectUri of ['http://remote.example/api/app/publishing/instagram/callback', 'https://site.example/wrong', `${config.redirectUri}?x=y`]) assert.throws(() => metaOAuthConfig({ ...config, redirectUri }), /configuration/);
});

test('real HTTP/account services keep cookies browser-bound and Page tokens private through selection', async () => {
  const f = fixture(), origin = 'http://127.0.0.1:3808', endpoint = `${origin}/api/app/publishing/instagram/accounts`;
  const trusted = { origin, 'content-type': 'application/json', 'x-viral-hit-workspace-request': '1' };
  let configured = config;
  const http = createInstagramAccountHttp({ config: () => configured, management: () => openInstagramAccountManagement(f.options), oauth: options => openInstagramAccounts({ ...f.options, ...options }) });
  try {
    assert.equal((await http.read(new Request(endpoint))).status, 403);
    const start = await http.change(new Request(endpoint, { method: 'POST', headers: trusted, body: '{"action":"connect"}' }));
    const result = await start.json(), state = new URL(result.authorizationUrl).searchParams.get('state')!, cookie = start.headers.get('set-cookie')!;
    assert.match(cookie, /Path=\/api\/app\/publishing\/instagram; HttpOnly; SameSite=Lax/);
    const callback = new URL(config.redirectUri); callback.search = new URLSearchParams({ state, code: 'private-code' }).toString();
    assert.equal((await http.callback(new Request(callback))).headers.get('location'), '/connections?instagram=invalid-callback'); assert.equal(f.remote.calls.length, 0);
    const valid = await http.callback(new Request(callback, { headers: { cookie: cookie.split(';')[0], 'sec-fetch-site': 'cross-site' } }));
    assert.equal(valid.headers.get('location'), `/connections?instagram=select&instagramState=${state}`); assert.equal(await valid.text(), '');
    assert.doesNotMatch(JSON.stringify([...valid.headers]), /private-code|fixture-meta/);
    const selection = await http.read(new Request(`${endpoint}?state=${state}`, { headers: { ...trusted, cookie: cookie.split(';')[0] } }));
    assert.equal(selection.status, 200); assert.doesNotMatch(await selection.text(), /fixture-meta|accessToken/);
    const chosen = await http.change(new Request(endpoint, { method: 'POST', headers: { ...trusted, cookie: cookie.split(';')[0] }, body: JSON.stringify({ action: 'select', state, pageId: '111' }) }));
    assert.equal(chosen.status, 200); assert.match(chosen.headers.get('set-cookie')!, /Max-Age=0/); const account = (await chosen.json()).account;
    configured = { ...config, clientId: '' };
    const disconnected = await http.change(new Request(endpoint, { method: 'POST', headers: trusted, body: JSON.stringify({ action: 'disconnect', accountId: account.id, revision: 1 }) }));
    assert.equal(disconnected.status, 200); assert.equal((await disconnected.json()).account.status, 'disconnected');
    assert.equal((await http.change(new Request(endpoint, { method: 'POST', headers: { ...trusted, origin: 'https://attacker.invalid' }, body: '{"action":"connect"}' }))).status, 403);
  } finally { f.cleanup(); }
});

test('a revoked Page token marks its account for reconnect without attempting container creation', async () => {
  const f = fixture();
  try {
    const flow = await f.begin(); await f.service.complete(flow.callback, binding, signal()); const account = await f.service.select(flow.state, binding, '111', signal());
    f.remote.rejectPage();
    await assert.rejects(f.service.connector().start({ schemaVersion: 1, projectId: 'project', connector: 'instagram', connectorVersion: '1', accountId: account.id, destinationId: '222', assets: [{ assetId: 'asset', sizeBytes: 10, sha256: 'a'.repeat(64), contentType: 'video/mp4' }], metadata: { kind: 'reel', caption: '', isAiGenerated: false } }, signal()));
    assert.equal(f.service.get(account.id)?.status, 'reconnect-required'); assert.ok(f.remote.calls.every(c => !c.path.includes('/media')));
  } finally { f.cleanup(); }
});

test('late token rejection from an old revision cannot invalidate reconnected access even if Meta reuses its token', async () => {
  const f = fixture();
  try {
    const flow = await f.begin(); await f.service.complete(flow.callback, binding, signal()); const account = await f.service.select(flow.state, binding, '111', signal());
    const next = await f.begin({ accountId: account.id, revision: 1 }); await f.service.complete(next.callback, binding, signal()); await f.service.select(next.state, binding, '111', signal());
    const local = openInstagramAccountManagement(f.options), identity = createMetaOAuth(config).identity;
    try {
      local.store.invalidate(account.id, identity, 'fixture-meta-page-111', 1); assert.equal(local.get(account.id)?.status, 'connected');
      local.store.invalidate(account.id, identity, 'fixture-meta-page-111', 2); assert.equal(local.get(account.id)?.status, 'reconnect-required');
    } finally { local.close(); }
  } finally { f.cleanup(); }
});

test('Page discovery reconstructs only fixed-host cursor requests and rejects repeated pagination cursors', async () => {
  for (const repeated of [false, true]) {
    const remote = createMetaFixture(); let pages = 0;
    const oauth = createMetaOAuth(config, { fetch: async (input, init) => {
      const response = await remote.request(input, init), url = new URL(String(input));
      if (url.pathname !== '/v26.0/me/accounts') return response;
      const body = await response.json(); pages++;
      if (pages === 2) assert.equal(url.searchParams.get('after'), 'cursor_1');
      return Response.json({ data: pages === 1 ? [body.data[0]] : repeated ? [] : [body.data[1]], ...((pages === 1 || repeated) ? { paging: { next: 'https://attacker.invalid/?access_token=fixture-private', cursors: { after: 'cursor_1' } } } : {}) });
    } });
    const { state } = oauth.begin(), callback = new URL(config.redirectUri); callback.search = new URLSearchParams({ state, code: 'fixture-code' }).toString();
    if (repeated) await assert.rejects(oauth.exchange(callback, state, signal()), /temporarily-unavailable/);
    else assert.deepEqual((await oauth.exchange(callback, state, signal())).map(g => g.pageId), ['111', '112']);
    assert.equal(pages, 2);
  }
});

test('known Page expiry requests reconnection, while a verified non-expiring Page grant has no invented refresh deadline', async () => {
  for (const finite of [true, false]) {
    const f = fixture();
    try {
      const native = f.options.fetch;
      f.options.fetch = async (input, init) => {
        const response = await native(input, init), url = new URL(String(input));
        if (finite && url.pathname.endsWith('/debug_token') && url.searchParams.get('input_token')?.startsWith('fixture-meta-page-')) {
          const body = await response.json(); body.data.expires_at = Math.floor(f.options.now() / 1000) + 120; return Response.json(body);
        }
        return response;
      };
      f.reopen(); const flow = await f.begin(); await f.service.complete(flow.callback, binding, signal()); const account = await f.service.select(flow.state, binding, '111', signal());
      f.tick(finite ? 61000 : 366 * 86400000);
      const local = openInstagramAccountManagement(f.options), identity = createMetaOAuth(config).identity;
      try {
        if (finite) { assert.throws(() => local.store.credential(account.id, identity), /grant-rejected/); assert.equal(local.get(account.id)?.status, 'reconnect-required'); }
        else { assert.equal(local.store.credential(account.id, identity).expiresAt, null); assert.equal(local.get(account.id)?.status, 'connected'); }
      } finally { local.close(); }
    } finally { f.cleanup(); }
  }
});
