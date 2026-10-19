import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { YOUTUBE_OAUTH_SCOPES } from './google-oauth.server';
import { PublicationRequestError } from './requests';

const directory = await mkdtemp(join(tmpdir(), 'vh-publication-app-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
process.env.VIRAL_HIT_GOOGLE_CLIENT_ID = 'fixture.apps.googleusercontent.com';
process.env.VIRAL_HIT_GOOGLE_CLIENT_SECRET = 'fixture-secret';
process.env.VIRAL_HIT_GOOGLE_REDIRECT_URI = 'http://127.0.0.1:3808/api/app/publishing/youtube/callback';
process.env.VIRAL_HIT_PUBLISHING_KEY = '1'.repeat(64);
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { createProject, deleteProjects } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { changePublication, listPublications } = await import('./application.server');
const { openPublications } = await import('./publication-files.server');
const { openPublicationRuntime } = await import('./runtime.server');
const { openYouTubeAccounts } = await import('./youtube-accounts.server');
const { runPublicationStep } = await import('./worker.server');
const { createPublicationHttp } = await import('../../routes/api/app/publishing/-publication-http.server');
const { publicationPreview } = await import('../../routes/api/app/publishing/-preview-http.server');
const video = join(directory, 'source.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
const metadata = { title: 'Reviewed project video', description: '', categoryId: '22', privacy: 'private' as const, tags: [], madeForKids: false, containsSyntheticMedia: true, notifySubscribers: false };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const fails = (code: PublicationRequestError['code']) => (error: unknown) => error instanceof PublicationRequestError && error.code === code;
const signal = () => AbortSignal.timeout(20000);
async function fixture() {
  const project = await createProject({ name: 'Publication admission' });
  const asset = await importLocalProjectAsset({ projectId: project.id, filePath: video });
  const source = await getProjectAssetById({ projectId: project.id, assetId: asset.id }); assert.ok(source);
  const accounts = openYouTubeAccounts({ fetch: async url => {
    if (String(url) === 'https://oauth2.googleapis.com/token') return json({ access_token: 'fixture-access-secret', refresh_token: 'fixture-refresh-secret', token_type: 'Bearer', expires_in: 3600, scope: YOUTUBE_OAUTH_SCOPES.join(' ') });
    assert.ok(String(url).includes('/channels?')); return json({ items: [{ id: 'fixture-channel', snippet: { title: 'Fixture channel' } }] });
  } });
  let account;
  try {
    const binding = randomBytes(32).toString('base64url'), start = await accounts.begin(binding);
    const callback = new URL(process.env.VIRAL_HIT_GOOGLE_REDIRECT_URI!);
    callback.search = new URLSearchParams({ code: 'fixture-code', state: new URL(start.authorizationUrl).searchParams.get('state')!, iss: 'https://accounts.google.com' }).toString();
    account = await accounts.complete(callback, binding, signal());
  } finally { accounts.close(); }
  return { projectId: project.id, source: resolveLocalProjectAssetPath({ objectKey: source.objectKey }), account,
    request: { action: 'create' as const, requestKey: randomUUID(), connector: 'youtube' as const, accountId: account.id, assetId: asset.id, metadata } };
}

test('admission is project scoped, binds metadata revisions and replays after source deletion', async () => {
  const f = await fixture(), foreign = await createProject({ name: 'Foreign project' });
  await assert.rejects(changePublication(foreign.id, f.request, 'cli'), fails('media-unavailable'));
  await assert.rejects(changePublication(f.projectId, { ...f.request, path: f.source }, 'cli'), fails('invalid-input'));
  await assert.rejects(changePublication(f.projectId, { ...f.request, accountId: randomUUID() }, 'cli'), fails('account-unavailable'));
  const draft = await changePublication(f.projectId, f.request, 'cli');
  assert.equal(draft.state, 'draft'); assert.equal(draft.destinationId, f.account.channelId);
  await assert.rejects(changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 1, expectedDigest: draft.digest }, 'cli'), fails('invalid-input'));
  const revised = await changePublication(f.projectId, { ...f.request, action: 'revise', requestKey: undefined, publicationId: draft.id, expectedRevision: 1 }, 'cli').catch(error => { assert.ok(fails('invalid-input')(error)); return null; });
  assert.equal(revised, null); // Strict schemas reject even an undefined foreign field.
  const { requestKey: _key, ...fields } = f.request;
  const updated = await changePublication(f.projectId, { ...fields, action: 'revise', publicationId: draft.id, expectedRevision: 1, metadata: { ...metadata, title: 'Changed title' } }, 'ui');
  assert.equal(updated.revision, 2); assert.notEqual(updated.digest, draft.digest);
  await rm(f.source);
  assert.equal((await changePublication(f.projectId, f.request, 'mcp')).revision, 2);
  await assert.rejects(changePublication(f.projectId, { ...f.request, metadata: { ...metadata, title: 'Different retry' } }, 'cli'), fails('conflict'));
  await assert.rejects(changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 2, expectedDigest: draft.digest, confirmed: true }, 'cli'), fails('conflict'));
  await assert.rejects(changePublication(foreign.id, { action: 'stop', publicationId: draft.id, expectedRevision: 2 }, 'cli'), fails('not-found'));
  const approved = await changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 2, expectedDigest: updated.digest, confirmed: true }, 'cli');
  assert.equal(approved.state, 'approved');
  assert.equal((await changePublication(f.projectId, { action: 'stop', publicationId: draft.id, expectedRevision: 2 }, 'cli')).state, 'canceled');
});

test('shared application and production runtime deliver retained bytes once with safe observed receipt', async () => {
  const f = await fixture(), draft = await changePublication(f.projectId, f.request, 'ui'), bytes = await readFile(f.source);
  await changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 1, expectedDigest: draft.digest, confirmed: true }, 'ui');
  await rm(f.source);
  let posts = 0, writes = 0, received = Buffer.alloc(0);
  const session = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=private-fixture-session';
  const receipt = (uploadStatus: string) => ({ id: 'testVideo01', snippet: { channelId: f.account.channelId }, status: { privacyStatus: 'private', uploadStatus } });
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-access-secret');
    if (String(url).includes('/channels?')) return json({ items: [{ id: f.account.channelId, snippet: { title: 'Fixture channel' } }] });
    if (init?.method === 'POST') { posts++; return new Response(null, { headers: { location: session } }); }
    if (init?.method === 'PUT') {
      assert.equal(String(url), session);
      if (new Headers(init.headers).get('content-range')!.startsWith('bytes */')) return new Response(null, { status: 308 });
      writes++; received = Buffer.from(init.body as Uint8Array); return json(receipt('uploaded'));
    }
    return json({ items: [receipt('processed')] });
  };
  const store = openPublications(); let runtime = openPublicationRuntime({ fetch: fetcher });
  try {
    assert.equal((await runPublicationStep(store, runtime))?.state, 'uploading');
    runtime.close(); runtime = openPublicationRuntime({ fetch: fetcher });
    assert.equal((await runPublicationStep(store, runtime))?.state, 'accepted');
    assert.equal((await runPublicationStep(store, runtime))?.state, 'ready');
    assert.equal(posts, 1); assert.equal(writes, 1); assert.deepEqual(received, bytes);
    assert.equal(createHash('sha256').update(received).digest('hex'), draft.asset?.sha256);
    const listing = await listPublications(f.projectId), view = listing.publications[0];
    assert.equal(view.state, 'ready'); assert.equal(view.delivery?.privacy, 'private');
    assert.equal(view.delivery?.url, 'https://www.youtube.com/watch?v=testVideo01');
    assert.doesNotMatch(JSON.stringify(listing), /fixture-access|fixture-refresh|private-fixture-session|leaseToken|checkpoint/);
  } finally { runtime.close(); store.close(); }
});

test('runtime refuses disconnected channels and deleted projects before any provider call', async () => {
  const f = await fixture(), draft = await changePublication(f.projectId, f.request, 'ui');
  await changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 1, expectedDigest: draft.digest, confirmed: true }, 'ui');
  const accounts = openYouTubeAccounts();
  try { accounts.disconnect(f.account.id, f.account.revision); } finally { accounts.close(); }
  const store = openPublications(), runtime = openPublicationRuntime({ fetch: async () => { assert.fail('Disconnected account must stay offline'); } });
  try {
    const result = await runPublicationStep(store, runtime);
    assert.equal(result?.id, draft.id); assert.equal(result?.state, 'approved'); assert.equal(result?.issue, 'runtime-unavailable');
    await assert.rejects(changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 1, expectedDigest: draft.digest, confirmed: true }, 'ui'), fails('account-unavailable'));
    store.stop(f.projectId, draft.id, 1);
    await deleteProjects({ projectIds: [f.projectId] });
    await assert.rejects(runtime.connector(store.get(f.projectId, draft.id)!.spec, signal()), /Project unavailable/);
  } finally { runtime.close(); store.close(); }
});

test('expired schedules and missing configuration cannot be approved', async () => {
  const f = await fixture();
  await assert.rejects(changePublication(f.projectId, { ...f.request, metadata: { ...metadata, publishAt: '2020-01-01T00:00:00Z' } }, 'ui'), fails('invalid-input'));
  const draft = await changePublication(f.projectId, f.request, 'ui'), client = process.env.VIRAL_HIT_GOOGLE_CLIENT_ID;
  delete process.env.VIRAL_HIT_GOOGLE_CLIENT_ID;
  try {
    assert.equal((await listPublications(f.projectId)).configured, false);
    await assert.rejects(changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 1, expectedDigest: draft.digest, confirmed: true }, 'ui'), fails('runtime-unavailable'));
  } finally { process.env.VIRAL_HIT_GOOGLE_CLIENT_ID = client; }
});

test('HTTP trust, bounded input, project scope and actual draft service share one admission contract', async () => {
  const f = await fixture(), http = createPublicationHttp(), url = `http://127.0.0.1:3808/api/app/projects/${f.projectId}/publications`;
  const headers = { 'x-viral-hit-workspace-request': '1', 'content-type': 'application/json', origin: 'http://127.0.0.1:3808' };
  assert.equal((await http.read(f.projectId, new Request(url))).status, 403);
  assert.equal((await http.change(f.projectId, new Request(url, { method: 'POST', headers: { ...headers, origin: 'https://foreign.example' }, body: JSON.stringify(f.request) }))).status, 403);
  assert.equal((await http.change(f.projectId, new Request(url, { method: 'POST', headers, body: ' '.repeat(32001) }))).status, 413);
  assert.equal((await http.change(f.projectId, new Request(url, { method: 'POST', headers, body: JSON.stringify({ ...f.request, sessionUrl: 'private' }) }))).status, 400);
  const response = await http.change(f.projectId, new Request(url, { method: 'POST', headers, body: JSON.stringify(f.request) }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const draft = await response.json(); assert.equal(draft.state, 'draft');
  const listing = await http.read(f.projectId, new Request(url, { headers }));
  assert.equal((await listing.json()).publications[0].id, draft.id);
  const broken = createPublicationHttp({ list: async () => { throw new Error('/private/path?token=secret'); }, change: changePublication });
  const unavailable = await broken.read(f.projectId, new Request(url, { headers }));
  assert.equal(unavailable.status, 503); assert.doesNotMatch(await unavailable.text(), /private|secret/);
});

test('standalone worker starts offline with an empty isolated queue and exits cleanly on SIGTERM', async () => {
  const empty = await mkdtemp(join(directory, 'empty-worker-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/publication-worker.ts'], { env: { ...process.env, VIRAL_HIT_DATA_DIR: empty, VIRAL_HIT_GOOGLE_CLIENT_ID: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  let output = '';
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('publication worker ready')) child.kill('SIGTERM'); });
    const code = await exit; assert.equal(code, 0); assert.match(output, /publication worker ready/);
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill('SIGKILL'); }
});

test('preview reads the retained revision after deletion, supports ranges, and rejects stale digests and cross-site embedding', async () => {
  const f = await fixture(), draft = await changePublication(f.projectId, f.request, 'ui'), bytes = await readFile(f.source);
  await rm(f.source);
  const url = `http://127.0.0.1:3808/api/app/projects/${f.projectId}/publications/${draft.id}/media?digest=${draft.digest}`;
  const ranged = await publicationPreview(f.projectId, draft.id, new Request(url, { headers: { range: 'bytes=3-19', 'sec-fetch-site': 'same-origin' } }));
  assert.equal(ranged.status, 206); assert.equal(ranged.headers.get('content-range'), `bytes 3-19/${bytes.length}`);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(3, 20));
  assert.equal(ranged.headers.get('cross-origin-resource-policy'), 'same-origin');
  const full = await publicationPreview(f.projectId, draft.id, new Request(url));
  assert.equal(full.status, 200); assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
  assert.equal((await publicationPreview(f.projectId, draft.id, new Request(url, { headers: { range: `bytes=${bytes.length}-` } }))).status, 416);
  assert.equal((await publicationPreview(f.projectId, draft.id, new Request(url, { headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403);
  assert.equal((await publicationPreview(f.projectId, draft.id, new Request(url.replace(draft.digest, '0'.repeat(64))))).status, 404);
  assert.equal((await publicationPreview(randomUUID(), draft.id, new Request(url))).status, 404);
});

test('confirmed resume preserves an inspected original session even after its scheduled time passes', async () => {
  const f = await fixture(), future = new Date(Date.now() + 600000).toISOString();
  const draft = await changePublication(f.projectId, { ...f.request, metadata: { ...metadata, publishAt: future } }, 'ui');
  await changePublication(f.projectId, { action: 'approve', publicationId: draft.id, expectedRevision: 1, expectedDigest: draft.digest, confirmed: true }, 'ui');
  const store = openPublications(), originalClock = Date.now;
  try {
    const first = store.claim()!; assert.equal(first.id, draft.id); store.begin(first);
    const checkpoint = { sessionUrl: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=original', nextByte: 0 };
    store.checkpoint(first, checkpoint);
    const inspection = store.claim()!;
    store.finish(inspection, 'uncertain', { checkpoint, issue: 'upload-incomplete' });
    Date.now = () => originalClock() + 3600000;
    const result = await changePublication(f.projectId, { action: 'resume', publicationId: draft.id, expectedRevision: 1, confirmed: true }, 'ui');
    assert.equal(result.state, 'uploading'); assert.equal(result.metadata?.publishAt, future);
    assert.deepEqual(store.get(f.projectId, draft.id)?.checkpoint, checkpoint);
    store.stop(f.projectId, draft.id, 1);
  } finally { Date.now = originalClock; store.close(); }
});
