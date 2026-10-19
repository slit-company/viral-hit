import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountHttp } from './-account-http.server';
import { openPublishingAccountManagement } from '@/core/publishing/account-management.server';
import { openYouTubeAccounts } from '@/core/publishing/youtube-accounts.server';
import { YOUTUBE_OAUTH_SCOPES } from '@/core/publishing/google-oauth.server';
import { WORKSPACE_MUTATION_HEADER } from '@/lib/trusted-local-request';

const origin = 'http://127.0.0.1:3808', callbackPath = '/api/app/publishing/youtube/callback';
const trusted = { [WORKSPACE_MUTATION_HEADER]: '1', origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vh-account-http-'));
  let config = { clientId: 'fixture.apps.googleusercontent.com', clientSecret: 'private-client-secret', redirectUri: origin + callbackPath }, calls = 0;
  const fetcher: typeof fetch = async (url) => {
    calls++;
    if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', token_type: 'Bearer', expires_in: 3600, scope: YOUTUBE_OAUTH_SCOPES.join(' ') });
    if (String(url).startsWith('https://www.googleapis.com/youtube/v3/channels?')) return Response.json({ items: [{ id: 'fixture-channel', snippet: { title: 'Fixture channel' } }] });
    throw new Error('No upload or other provider request is allowed');
  };
  const http = createAccountHttp({ config: () => config,
    management: () => openPublishingAccountManagement({ root, key: '2'.repeat(64) }),
    oauth: (options) => openYouTubeAccounts({ ...options, root, key: '2'.repeat(64), fetch: fetcher }),
  });
  const req = (body: unknown, overrides: Record<string, string> = {}) => new Request(origin + '/api/app/publishing/accounts', { method: 'POST', headers: { ...trusted, ...overrides }, body: JSON.stringify(body) });
  async function begin(reconnect?: { accountId: string; revision: number }) {
    const response = await http.change(req({ action: 'connect', ...(reconnect ? { reconnect } : {}) }));
    assert.equal(response.status, 200);
    const result = await response.json(), cookie = response.headers.get('set-cookie')!;
    const url = new URL(config.redirectUri); url.search = new URLSearchParams({ state: new URL(result.authorizationUrl).searchParams.get('state')!, code: 'private-code', iss: 'https://accounts.google.com' }).toString();
    return { response, result, cookie, url, request: () => new Request(url, { headers: { cookie: cookie.split(';')[0], 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } }) };
  }
  const read = () => http.read(new Request(origin + '/api/app/publishing/accounts', { headers: trusted }));
  return { root, http, req, begin, read, calls: () => calls, configure: (patch: Partial<typeof config>) => { config = { ...config, ...patch }; }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('trusted browser connection crosses real OAuth/account services and returns only safe channel views', async () => {
  const f = fixture();
  try {
    const flow = await f.begin();
    assert.match(flow.cookie, /HttpOnly; SameSite=Lax; Max-Age=600/); assert.match(flow.cookie, /Path=\/api\/app\/publishing\/youtube\/callback/); assert.doesNotMatch(flow.cookie, /Domain=|Secure/);
    assert.equal(new URL(flow.result.authorizationUrl).searchParams.get('code_challenge_method'), 'S256');
    assert.equal(flow.response.headers.get('cache-control'), 'no-store');
    const response = await f.http.callback(flow.request());
    assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/connections?youtube=connected');
    assert.match(response.headers.get('set-cookie')!, /Max-Age=0/); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy')!, /default-src 'none'/); assert.equal(await response.text(), '');
    const view = await (await f.read()).json(); assert.equal(view.youtube, 'ready'); assert.equal(view.accounts[0].channelId, 'fixture-channel');
    assert.equal(view.accounts[0].status, 'connected'); assert.equal(f.calls(), 2);
    assert.doesNotMatch(JSON.stringify(view), /private-|verifier|credential|state_hash/);
    const stored = readFileSync(join(f.root, 'accounts.sqlite'));
    assert.equal(stored.includes(Buffer.from('private-refresh-token')), false);
    assert.equal((await f.http.callback(flow.request())).headers.get('location'), '/connections?youtube=invalid-callback'); assert.equal(f.calls(), 2);
  } finally { f.cleanup(); }
});

test('read and mutation trust reject cross-site or unmarked requests before opening any account service', async () => {
  const f = fixture();
  try {
    for (const headers of [{}, { ...trusted, origin: 'https://attacker.example' }, { ...trusted, 'sec-fetch-site': 'cross-site' }]) {
      assert.equal((await f.http.read(new Request(origin + '/api/app/publishing/accounts', { headers }))).status, 403);
    }
    assert.equal((await f.http.change(f.req({ action: 'connect' }, { origin: 'https://attacker.example' }))).status, 403);
    assert.equal((await f.http.change(f.req({ action: 'connect' }, { 'content-type': 'text/plain' }))).status, 415);
    assert.equal((await f.http.change(f.req({ action: 'connect', extra: true }))).status, 400);
    assert.equal((await f.http.change(f.req({ action: 'connect', extra: 'x'.repeat(5000) }))).status, 413);
    assert.equal(f.calls(), 0);
  } finally { f.cleanup(); }
});

test('per-flow cookies support parallel tabs and reject missing, wrong and duplicate browser bindings without consuming the flow', async () => {
  const f = fixture();
  try {
    const a = await f.begin(), b = await f.begin(); assert.notEqual(a.cookie.split('=')[0], b.cookie.split('=')[0]);
    for (const cookie of ['', a.cookie.split('=')[0] + '=' + 'x'.repeat(43), a.cookie.split(';')[0] + '; ' + a.cookie.split(';')[0]]) {
      assert.equal((await f.http.callback(new Request(a.url, { headers: { cookie } }))).headers.get('location'), '/connections?youtube=invalid-callback');
    }
    assert.equal(f.calls(), 0);
    assert.equal((await f.http.callback(b.request())).headers.get('location'), '/connections?youtube=connected');
    assert.equal((await f.http.callback(a.request())).headers.get('location'), '/connections?youtube=connected');
    assert.equal((await (await f.read()).json()).accounts.length, 2);
  } finally { f.cleanup(); }
});

test('denied and malformed callbacks never reflect codes, state, errors or redirect targets', async () => {
  const f = fixture();
  try {
    const flow = await f.begin(); flow.url.searchParams.delete('code'); flow.url.searchParams.set('error', 'access_denied');
    flow.url.searchParams.set('error_description', '<script>private</script>'); flow.url.searchParams.set('returnTo', 'https://attacker.example');
    const response = await f.http.callback(flow.request());
    assert.equal(response.headers.get('location'), '/connections?youtube=denied'); assert.equal(f.calls(), 0);
    assert.doesNotMatch(JSON.stringify([...response.headers]), /private|script>|attacker/);
    const duplicate = await f.begin(); duplicate.url.searchParams.append('state', duplicate.url.searchParams.get('state')!);
    assert.equal((await f.http.callback(duplicate.request())).headers.get('location'), '/connections?youtube=invalid-callback');
    assert.equal(f.calls(), 0);
  } finally { f.cleanup(); }
});

test('configured origin is pinned independently from host headers, with secure cookies for HTTPS', async () => {
  const f = fixture();
  try {
    f.configure({ redirectUri: 'https://studio.example' + callbackPath });
    assert.equal((await (await f.read()).json()).youtube, 'origin-mismatch');
    assert.equal((await f.http.change(f.req({ action: 'connect' }))).status, 503);
    const response = await f.http.change(new Request('https://studio.example/api/app/publishing/accounts', { method: 'POST', headers: { ...trusted, origin: 'https://studio.example' }, body: '{"action":"connect"}' }));
    assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie')!, /; Secure$/);
    f.configure({ clientId: '' }); assert.equal((await (await f.read()).json()).youtube, 'configuration');
    assert.equal(f.calls(), 0);
  } finally { f.cleanup(); }
});

test('local disconnect survives lost provider configuration, rejects stale revisions and invalidates in-flight reconnects', async () => {
  const f = fixture();
  try {
    const first = await f.begin(); await f.http.callback(first.request());
    const account = (await (await f.read()).json()).accounts[0];
    const reconnect = await f.begin({ accountId: account.id, revision: account.revision });
    f.configure({ clientId: '' });
    const command = { action: 'disconnect', accountId: account.id, revision: account.revision };
    const result = await f.http.change(f.req(command)); assert.equal(result.status, 200); assert.equal((await result.json()).account.status, 'disconnected');
    assert.equal((await f.http.change(f.req(command))).status, 409);
    f.configure({ clientId: 'fixture.apps.googleusercontent.com' });
    assert.equal((await f.http.callback(reconnect.request())).headers.get('location'), '/connections?youtube=invalid-callback');
    assert.equal(f.calls(), 2);
    const again = await f.begin({ accountId: account.id, revision: account.revision + 1 });
    assert.equal((await f.http.callback(again.request())).headers.get('location'), '/connections?youtube=connected');
  } finally { f.cleanup(); }
});
