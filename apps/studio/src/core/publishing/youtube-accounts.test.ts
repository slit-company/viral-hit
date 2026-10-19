import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openYouTubeAccounts } from './youtube-accounts.server';
import { YOUTUBE_OAUTH_SCOPES } from './google-oauth.server';
import { PublicationAccountError, type AccountIssue } from './account-contract';
import { PublicationStore } from './store.server';
import { runPublicationStep } from './worker.server';
import type { PublicationSpec } from './contracts';

const config = { clientId: 'fixture.apps.googleusercontent.com', clientSecret: 'fixture-secret', redirectUri: 'http://127.0.0.1:3808/api/app/publishing/youtube/callback' };
const signal = () => AbortSignal.timeout(10000);
const fails = (code: AccountIssue) => (error: unknown) => error instanceof PublicationAccountError && error.code === code;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function callback(url: string) {
  const result = new URL(config.redirectUri); result.search = new URLSearchParams({ code: 'fixture-code', state: new URL(url).searchParams.get('state')!, iss: 'https://accounts.google.com' }).toString(); return result;
}
function gate() {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
  return { enter, entered, release, released };
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vh-accounts-')), binding = randomBytes(32).toString('base64url');
  let now = Date.now(), exchanges = 0, refreshes = 0, posts = 0;
  const control = { channelId: 'fixture-channel', channels: 1, rejectOldToken: false, tokenError: null as string | null, refreshGate: null as ReturnType<typeof gate> | null, exchangeGate: null as ReturnType<typeof gate> | null };
  const requests: { grant: string; refresh: string | null; verifier: string | null }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body)), grant = body.get('grant_type')!;
      requests.push({ grant, refresh: body.get('refresh_token'), verifier: body.get('code_verifier') });
      if (grant === 'refresh_token') { refreshes++; control.refreshGate?.enter(); await control.refreshGate?.released; }
      else { exchanges++; control.exchangeGate?.enter(); await control.exchangeGate?.released; }
      if (control.tokenError) return json({ error: control.tokenError, error_description: 'fixture-private-response' }, control.tokenError === 'temporarily_unavailable' ? 503 : 400);
      return json({ access_token: `fixture-access-${exchanges}-${refreshes}`, refresh_token: grant === 'authorization_code' ? `fixture-refresh-secret-${exchanges}` : undefined,
        token_type: 'Bearer', expires_in: 3600, scope: grant === 'authorization_code' ? YOUTUBE_OAUTH_SCOPES.join(' ') : undefined });
    }
    if (String(url).includes('/channels?')) {
      if (control.rejectOldToken && new Headers(init?.headers).get('authorization') === 'Bearer fixture-access-1-0') return json({ error: 'unauthorized' }, 401);
      return json({ items: Array.from({ length: control.channels }, () => ({ id: control.channelId, snippet: { title: 'Fixture channel' } })) });
    }
    if (init?.method === 'POST' && String(url).includes('/upload/youtube/')) {
      posts++; return new Response(null, { headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture' } });
    }
    throw new Error('Unexpected account fixture request');
  };
  const services = new Set<ReturnType<typeof openYouTubeAccounts>>();
  const open = (overrides = config) => {
    const service = openYouTubeAccounts({ config: overrides, root, key: '1'.repeat(64), fetch: fetcher, now: () => now }); services.add(service); return service;
  };
  const service = open();
  return {
    root, binding, service, open, control, requests,
    tick: (milliseconds = 3600001) => { now += milliseconds; },
    counts: () => ({ exchanges, refreshes, posts }),
    close: (service: ReturnType<typeof openYouTubeAccounts>) => { service.close(); services.delete(service); },
    connect: async () => service.complete(callback((await service.begin(binding)).authorizationUrl), binding, signal()),
    cleanup: () => { for (const service of services) service.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

test('a bound one-time callback persists encrypted credentials and reopens with safe account views', async () => {
  const f = fixture();
  try {
    const start = await f.service.begin(f.binding), url = callback(start.authorizationUrl);
    await assert.rejects(f.service.complete(url, randomBytes(32).toString('base64url'), signal()), fails('invalid-callback'));
    assert.equal(f.counts().exchanges, 0);
    const account = await f.service.complete(url, f.binding, signal());
    await assert.rejects(f.service.complete(url, f.binding, signal()), fails('invalid-callback'));
    assert.equal(account.channelId, 'fixture-channel'); assert.equal(account.status, 'connected');
    assert.equal(JSON.stringify(f.service.list()).includes('fixture-refresh'), false);
    const verifier = f.requests[0].verifier!, state = url.searchParams.get('state')!;
    for (const file of readdirSync(f.root).filter(name => name.startsWith('accounts.sqlite'))) {
      const bytes = readFileSync(join(f.root, file));
      for (const secret of [verifier, state, f.binding, 'fixture-refresh-secret-1', 'fixture-access-1-0']) assert.equal(bytes.includes(Buffer.from(secret)), false);
    }
    f.close(f.service); const reopened = f.open();
    assert.equal(await reopened.accessToken(account.id, signal()), 'fixture-access-1-0');
    assert.equal(f.counts().refreshes, 0); assert.equal(f.counts().posts, 0);
  } finally { f.cleanup(); }
});

test('expired and client-mismatched callbacks fail before requests while restoring the original client can finish', async () => {
  const f = fixture();
  try {
    const flow = await f.service.begin(f.binding), other = f.open({ ...config, clientId: 'another.apps.googleusercontent.com' });
    await assert.rejects(other.complete(callback(flow.authorizationUrl), f.binding, signal()), fails('invalid-callback'));
    assert.equal(f.counts().exchanges, 0);
    const account = await f.service.complete(callback(flow.authorizationUrl), f.binding, signal());
    await assert.rejects(other.accessToken(account.id, signal()), fails('configuration'));
    const stale = await f.service.begin(f.binding); f.tick(600001);
    await assert.rejects(f.service.complete(callback(stale.authorizationUrl), f.binding, signal()), fails('invalid-callback'));
    assert.equal(f.counts().exchanges, 1);
  } finally { f.cleanup(); }
});

test('reconnecting an account cannot silently replace the destination approved by earlier jobs', async () => {
  const f = fixture();
  try {
    const account = await f.connect();
    const reconnect = await f.service.begin(f.binding, { accountId: account.id, revision: account.revision });
    f.control.channelId = 'different-channel';
    await assert.rejects(f.service.complete(callback(reconnect.authorizationUrl), f.binding, signal()), fails('identity-mismatch'));
    assert.equal(f.service.get(account.id)?.channelId, account.channelId);
    assert.equal(await f.service.accessToken(account.id, signal()), 'fixture-access-1-0');
    const another = await f.connect(); assert.notEqual(another.id, account.id); assert.equal(another.channelId, 'different-channel');
  } finally { f.cleanup(); }
});

test('disconnect fences a callback already exchanging tokens and cannot be undone by its late response', async () => {
  const f = fixture();
  try {
    const account = await f.connect(), flow = await f.service.begin(f.binding, { accountId: account.id, revision: account.revision });
    const blocked = gate(); f.control.exchangeGate = blocked;
    const pending = f.service.complete(callback(flow.authorizationUrl), f.binding, signal()); await blocked.entered;
    f.service.disconnect(account.id, account.revision); blocked.release();
    await assert.rejects(pending, fails('invalid-callback'));
    assert.equal(f.service.get(account.id)?.status, 'disconnected');
    await assert.rejects(f.service.accessToken(account.id, signal()), fails('disconnected'));
  } finally { f.cleanup(); }
});

test('two store owners serialize refresh and reuse the newly stored access token', async () => {
  const f = fixture();
  try {
    const account = await f.connect(), other = f.open(); f.tick();
    const blocked = gate(); f.control.refreshGate = blocked;
    const pending = f.service.accessToken(account.id, signal()); await blocked.entered;
    await assert.rejects(other.accessToken(account.id, signal()), fails('busy'));
    blocked.release(); assert.equal(await pending, 'fixture-access-1-1');
    assert.equal(await other.accessToken(account.id, signal()), 'fixture-access-1-1'); assert.equal(f.counts().refreshes, 1);
    f.control.refreshGate = null; f.tick(); await other.accessToken(account.id, signal());
    assert.deepEqual(f.requests.filter(request => request.grant === 'refresh_token').map(request => request.refresh), ['fixture-refresh-secret-1', 'fixture-refresh-secret-1']);
  } finally { f.cleanup(); }
});

test('disconnect fences an in-flight refresh and cannot restore its credential', async () => {
  const f = fixture();
  try {
    const account = await f.connect(); f.tick(); const blocked = gate(); f.control.refreshGate = blocked;
    const pending = f.service.accessToken(account.id, signal()); await blocked.entered;
    f.service.disconnect(account.id, account.revision); blocked.release();
    await assert.rejects(pending, fails('disconnected')); assert.equal(f.service.get(account.id)?.status, 'disconnected');
    await assert.rejects(f.service.accessToken(account.id, signal()), fails('disconnected'));
  } finally { f.cleanup(); }
});

test('transient and configuration failures preserve grants with backoff; revoked grants require reconnection', async () => {
  for (const tokenError of ['temporarily_unavailable', 'invalid_client', 'invalid_grant']) {
    const f = fixture();
    try {
      const account = await f.connect(); f.tick(); f.control.tokenError = tokenError;
      await assert.rejects(f.service.accessToken(account.id, signal()), fails(tokenError === 'invalid_client' ? 'configuration' : tokenError === 'invalid_grant' ? 'grant-rejected' : 'temporarily-unavailable'));
      assert.equal(f.service.get(account.id)?.status, tokenError === 'invalid_grant' ? 'reconnect-required' : 'connected');
      f.control.tokenError = null;
      if (tokenError !== 'invalid_grant') {
        await assert.rejects(f.service.accessToken(account.id, signal()), fails('busy')); f.tick(30001);
        assert.equal(await f.service.accessToken(account.id, signal()), 'fixture-access-1-2');
      }
    } finally { f.cleanup(); }
  }
});

test('refreshed credentials must still resolve to the original channel', async () => {
  const f = fixture();
  try {
    const account = await f.connect(); f.tick(); f.control.channelId = 'wrong-channel';
    await assert.rejects(f.service.accessToken(account.id, signal()), fails('identity-mismatch'));
    assert.equal(f.service.get(account.id)?.status, 'reconnect-required'); assert.equal(f.service.get(account.id)?.channelId, account.channelId);
  } finally { f.cleanup(); }
});

test('a rejected cached token is invalidated without replaying creation; the next approved step refreshes first', async () => {
  const f = fixture(); let clock = Date.now(); const store = new PublicationStore(':memory:', () => clock);
  try {
    const account = await f.connect(); f.control.rejectOldToken = true;
    const spec: PublicationSpec = { schemaVersion: 1, projectId: 'project', connector: 'youtube', connectorVersion: '1', accountId: account.id, destinationId: account.channelId,
      assets: [{ assetId: 'asset', sha256: 'a'.repeat(64), sizeBytes: 10, contentType: 'video/mp4' }], metadata: { title: 'Reviewed', description: '', categoryId: '22', privacy: 'private', madeForKids: false, containsSyntheticMedia: true, notifySubscribers: false } };
    const draft = store.create(spec, 'one'); store.approve('project', draft.id, 1, draft.digest, 'operator');
    const runtime = { connector: async () => f.service.connector(), validateAssets: async () => {}, read: async () => new Uint8Array(10) };
    assert.equal((await runPublicationStep(store, runtime))?.state, 'approved'); assert.equal(f.counts().posts, 0);
    clock += 30001;
    assert.equal((await runPublicationStep(store, runtime))?.state, 'uploading');
    assert.equal(f.counts().refreshes, 1); assert.equal(f.counts().posts, 1);
  } finally { store.close(); f.cleanup(); }
});
