import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMetaFixture } from '../../../tests/support/meta-fixture';

const directory = await mkdtemp(join(tmpdir(), 'vh-instagram-inbox-'));
Object.assign(process.env, { VIRAL_HIT_DATA_DIR: directory, VIRAL_HIT_META_APP_ID: '123', VIRAL_HIT_META_APP_SECRET: 'fixture-only', VIRAL_HIT_META_LOGIN_CONFIG_ID: '456', VIRAL_HIT_META_REDIRECT_URI: 'http://127.0.0.1:3808/api/app/publishing/instagram/callback' });
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { createProject } = await import('../projects/projects');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { openInstagramAccounts } = await import('../publishing/instagram-accounts.server');
const { InstagramInboxStore } = await import('./instagram-inbox-store.server');
const { collectInstagramInbox, runInstagramInboxLoop } = await import('./instagram-inbox.server');
const { changeInbox, inboxOverview, InboxRequestError } = await import('./instagram-inbox-application.server');

const clip = join(directory, 'clip.mp4');
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=180x320:r=30:d=3.2', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', clip]);
const signal = () => AbortSignal.timeout(60000);
const video = (id: string) => `https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=${id}&signature=fixture`;
const now = Date.now(), iso = (offset: number) => new Date(now - offset).toISOString().replace('Z', '+0000');

function graph(options: { error?: { status: number; code: number } } = {}) {
  const calls: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname + url.search);
    assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer page-token');
    if (options.error) return Response.json({ error: { code: options.error.code, message: 'fixture' } }, { status: options.error.status });
    if (url.pathname === '/v26.0/111/conversations') {
      assert.equal(url.searchParams.get('platform'), 'instagram');
      return Response.json({ data: [{ id: 'conversation-new', updated_time: iso(60_000) }, { id: 'conversation-old', updated_time: iso(30 * 86_400_000) }] });
    }
    if (url.pathname === '/v26.0/conversation-new') {
      assert.match(url.searchParams.get('fields') ?? '', /^messages\.limit\(20\)/); assert.doesNotMatch(url.searchParams.get('fields') ?? '', /message[,}]/);
      return Response.json({ id: 'conversation-new', messages: { data: [
        { id: 'm-video', created_time: iso(120_000), from: { id: '9001', username: 'fan_one' }, attachments: { data: [{ video_data: { url: video('1') } }] } },
        { id: 'm-reel', created_time: iso(90_000), from: { id: '9002', username: 'fan_two' }, shares: { data: [{ type: 'ig_reel', url: 'https://scontent.cdninstagram.com/clip.mp4' }] } },
        { id: 'm-own', created_time: iso(80_000), from: { id: '222', username: 'studio' }, attachments: { data: [{ video_data: { url: video('2') } }] } },
      ] } });
    }
    throw new Error('Unexpected Graph request ' + url.pathname);
  };
  return { request, calls };
}

test('a check saves new DM videos as project references once, and access problems are recorded without downloads', async () => {
  const project = await createProject({ name: 'Inbox references' }), store = new InstagramInboxStore(join(directory, 'inbox-a.sqlite'));
  const downloads: string[] = [], invalidated: string[] = [];
  const deps = (request: typeof fetch, fail = false) => ({ store, fetch: request,
    credential: async () => ({ pageId: '111', instagramId: '222', accessToken: 'page-token' }),
    invalidate: (accountId: string) => { invalidated.push(accountId); },
    download: async (url: string, file: string) => { downloads.push(url); if (fail) throw new Error('expired link'); await copyFile(clip, file); } });
  try {
    store.configure('account-a', { projectId: project.id, enabled: true }, 0);
    assert.deepEqual(store.due(), ['account-a']);
    const first = graph(), result = await collectInstagramInbox('account-a', deps(first.request), signal());
    assert.deepEqual(result, { outcome: 'ok', imported: 2, failed: 0 });
    assert.deepEqual(downloads, ['https://scontent.cdninstagram.com/clip.mp4', video('1')]);
    assert.equal(first.calls.some(call => call.includes('conversation-old')), false);
    const recent = store.recent('account-a');
    assert.deepEqual(recent.map(item => [item.senderUsername, item.kind]).sort(), [['fan_one', 'video'], ['fan_two', 'reel']]);
    for (const item of recent) assert.equal((await getProjectAssetById({ projectId: project.id, assetId: item.assetId! }))?.type, 'video');
    assert.equal(store.check('account-a').outcome, 'ok'); assert.deepEqual(store.due(), []);
    assert.deepEqual(await collectInstagramInbox('account-a', deps(graph().request), signal()), { outcome: 'ok', imported: 0, failed: 0 });
    assert.equal(downloads.length, 2);
    const denied = graph({ error: { status: 403, code: 10 } });
    assert.equal((await collectInstagramInbox('account-a', deps(denied.request), signal())).outcome, 'permission-missing');
    assert.equal((await collectInstagramInbox('account-a', deps(graph({ error: { status: 400, code: 190 } }).request), signal())).outcome, 'reconnect');
    assert.deepEqual(invalidated, ['account-a']); assert.equal(downloads.length, 2);
  } finally { store.close(); }
});

test('failed downloads retry on later checks up to three attempts, and the worker loop runs requested checks', async () => {
  const project = await createProject({ name: 'Inbox retries' }), store = new InstagramInboxStore(join(directory, 'inbox-b.sqlite'));
  let attempts = 0;
  const deps = { store, fetch: graph().request, credential: async () => ({ pageId: '111', instagramId: '222', accessToken: 'page-token' }), download: async () => { attempts++; throw new Error('expired link'); } };
  try {
    store.configure('account-b', { projectId: project.id, enabled: false }, 0);
    for (let check = 0; check < 4; check++) assert.equal((await collectInstagramInbox('account-b', deps, signal())).outcome, 'ok');
    assert.equal(attempts, 6, 'two videos, three attempts each, then left alone');
    assert.deepEqual(store.due(), []);
    store.requestCheck('account-b'); assert.deepEqual(store.due(), ['account-b']);
    const stop = new AbortController(); let passes = 0;
    await runInstagramInboxLoop(stop.signal, () => { passes++; if (passes > 1) { stop.abort(); return null; } return { deps, close() {} }; }, 1);
    assert.equal(store.check('account-b').requestedAt, null); assert.deepEqual(store.due(), []);
  } finally { store.close(); }
});

test('settings require a connected account, an active project and the current revision', async () => {
  const project = await createProject({ name: 'Inbox settings' }), remote = createMetaFixture(), accounts = openInstagramAccounts({ fetch: remote.request });
  let accountId: string;
  try {
    const binding = 'd'.repeat(43), flow = accounts.begin(binding), state = new URL(flow.authorizationUrl).searchParams.get('state')!;
    const callback = new URL(process.env.VIRAL_HIT_META_REDIRECT_URI!); callback.search = new URLSearchParams({ state, code: 'fixture-code' }).toString();
    await accounts.complete(callback, binding, signal()); accountId = (await accounts.select(state, binding, '111', signal())).id;
  } finally { accounts.close(); }
  const fails = (code: string) => (error: unknown) => error instanceof InboxRequestError && error.code === code;
  await assert.rejects(changeInbox({ action: 'check', accountId }), fails('invalid-input'));
  await assert.rejects(changeInbox({ action: 'configure', accountId, projectId: 'missing-project', enabled: true, expectedRevision: 0 }), fails('not-found'));
  await assert.rejects(changeInbox({ action: 'configure', accountId: crypto.randomUUID(), projectId: project.id, enabled: true, expectedRevision: 0 }), fails('not-found'));
  const saved = await changeInbox({ action: 'configure', accountId, projectId: project.id, enabled: true, expectedRevision: 0 });
  assert.equal(saved.settings?.revision, 1); assert.equal(saved.settings?.enabled, true); assert.equal(saved.connected, true);
  await assert.rejects(changeInbox({ action: 'configure', accountId, projectId: project.id, enabled: false, expectedRevision: 0 }), fails('conflict'));
  const requested = await changeInbox({ action: 'check', accountId });
  assert.ok(requested.check.requestedAt);
  const overview = inboxOverview();
  assert.deepEqual(overview.inboxes.map(item => [item.accountId, item.username, item.settings?.projectId]), [[accountId, 'open_studio', project.id]]);
  assert.doesNotMatch(JSON.stringify(overview), /fixture-meta|token/i);
});
