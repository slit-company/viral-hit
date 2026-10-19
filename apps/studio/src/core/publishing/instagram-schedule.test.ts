import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicationStore } from './store.server';
import { createInstagramConnector } from './instagram-connector.server';
import { runPublicationStep } from './worker.server';
import { instagramMetadataSchema } from './instagram-contract';
import { instagramNotBefore, validateInstagramSchedule } from './instagram-schedule';
import type { PublicationSpec } from './contracts';

const base = Date.parse('2030-01-01T00:00:00Z');
function fixture(delay = 2 * 86400000) {
  let now = base, bytes = 0, published = false, losePublish = false, remoteCalls = 0, creates = 0, uploads = 0, publishes = 0, assetChecks = 0;
  let onPage: (() => void) | undefined, onStatus: (() => void) | undefined;
  const directory = mkdtempSync(join(tmpdir(), 'vh-instagram-schedule-')), file = join(directory, 'publication.sqlite');
  let store = new PublicationStore(file, () => now);
  const spec: PublicationSpec = { schemaVersion: 1, projectId: 'project', connector: 'instagram', connectorVersion: '1', accountId: 'account', destinationId: '222', assets: [{ assetId: 'asset', sha256: 'a'.repeat(64), sizeBytes: 10, contentType: 'video/mp4' }], metadata: { kind: 'reel', caption: 'A scheduled experiment', isAiGenerated: true, publishAt: new Date(base + delay).toISOString() } };
  const connector = createInstagramConnector({ credential: async () => ({ pageId: '111', instagramId: '222', accessToken: 'fixture-only' }), fetch: async (input, init) => {
    remoteCalls++; const url = new URL(String(input));
    if (url.pathname === '/v26.0/111') { onPage?.(); return Response.json({ id: '111', instagram_business_account: { id: '222' } }); }
    if (url.pathname === '/v26.0/222/media') {
      creates++; const body = JSON.parse(init!.body as string); assert.equal(body.publishAt, undefined); assert.equal(body.scheduled_publish_time, undefined);
      return Response.json({ id: '333', uri: 'https://rupload.facebook.com/ig-api-upload/v26.0/333' });
    }
    if (url.hostname === 'rupload.facebook.com') { uploads++; bytes = (await new Response(init!.body).arrayBuffer()).byteLength; return Response.json({ success: true }); }
    if (url.pathname === '/v26.0/333') { onStatus?.(); return Response.json({ id: '333', status_code: published ? 'PUBLISHED' : bytes ? 'FINISHED' : 'IN_PROGRESS', video_status: { uploading_phase: { status: bytes ? 'complete' : 'not_started', bytes_transferred: bytes } } }); }
    assert.equal(url.pathname, '/v26.0/222/media_publish'); assert.equal(init?.method, 'POST'); publishes++; published = true;
    if (losePublish) throw new Error('Lost final response');
    return Response.json({ id: '444' });
  } });
  const draft = store.create(spec, 'scheduled'), realNow = Date.now; Date.now = () => now;
  const runtime = { connector: async () => connector, validateAssets: async () => { assetChecks++; }, read: async (_spec: PublicationSpec, _asset: number, _offset: number, length: number) => new Uint8Array(length) };
  return { spec, draft, connector, get store() { return store; }, get record() { return store.get('project', draft.id)!; },
    counts: () => ({ remoteCalls, creates, uploads, publishes, assetChecks }), at: (time: number) => { now = time; },
    beforePage: (fn: () => void) => { onPage = fn; }, beforeStatus: (fn: () => void) => { onStatus = fn; }, loseReply: () => { losePublish = true; },
    approve: () => store.approve('project', draft.id, draft.revision, draft.digest, 'ui'),
    step: () => runPublicationStep(store, runtime),
    reopen: () => { store.close(); store = new PublicationStore(file, () => now); },
    cleanup: () => { Date.now = realNow; store.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

test('far-future reservation stays local across restarts, prepares ten minutes before and publishes only at the approved time', async () => {
  const f = fixture(), due = base + 2 * 86400000;
  try {
    f.approve(); assert.equal((await f.step())?.state, 'approved'); assert.deepEqual(f.counts(), { remoteCalls: 0, creates: 0, uploads: 0, publishes: 0, assetChecks: 0 });
    assert.equal(f.record.nextPoll, base + 86400000); f.reopen(); assert.equal(await f.step(), null);
    f.at(base + 86400000); await f.step(); assert.equal(f.record.nextPoll, due - 600000);
    f.at(due - 600001); assert.equal(await f.step(), null); assert.equal(f.counts().remoteCalls, 0);
    f.at(due - 600000); assert.equal((await f.step())?.state, 'uploading');
    assert.equal((await f.step())?.state, 'accepted'); assert.equal((await f.step())?.state, 'staged');
    assert.equal((await f.step())?.state, 'staged'); assert.equal(f.record.nextPoll, due); assert.equal(f.counts().publishes, 0);
    f.reopen(); f.at(due - 1); assert.equal(await f.step(), null);
    f.at(due); assert.equal((await f.step())?.state, 'published');
    assert.equal(f.counts().creates, 1); assert.equal(f.counts().uploads, 1); assert.equal(f.counts().publishes, 1);
  } finally { f.cleanup(); }
});

test('editing an approved waiting reservation invalidates approval and removes its old queue deadline', async () => {
  const f = fixture();
  try {
    f.approve(); await f.step(); assert.ok(f.record.nextPoll > base);
    const metadata = { kind: 'story', isAiGenerated: false };
    const revised = f.store.revise('project', f.draft.id, 1, { ...f.spec, metadata });
    assert.equal(revised.state, 'draft'); assert.equal(revised.nextPoll, 0); assert.equal(revised.approval, null); assert.notEqual(revised.digest, f.draft.digest);
    assert.throws(() => f.store.approve('project', f.draft.id, 2, f.draft.digest, 'ui'), /changed after review/);
    f.store.approve('project', f.draft.id, 2, revised.digest, 'ui'); assert.equal((await f.step())?.state, 'uploading');
    assert.equal(f.counts().creates, 1);
  } finally { f.cleanup(); }
});

test('a stop during the preparation window cancels a local reservation without a container', async () => {
  const f = fixture();
  try {
    f.approve(); await f.step(); assert.equal(f.store.stop('project', f.draft.id, 1).state, 'canceled');
    f.at(base + 3 * 86400000); f.reopen(); assert.equal(await f.step(), null); assert.equal(f.counts().remoteCalls, 0);
  } finally { f.cleanup(); }
});

test('clock rollback during account lookup defers container creation after its durable starting fence', async () => {
  const f = fixture(600000);
  try {
    f.approve(); f.beforePage(() => f.at(base - 60000));
    assert.equal((await f.step())?.state, 'approved'); assert.equal(f.counts().creates, 0); assert.equal(f.record.nextPoll, base); assert.equal(f.record.issue, null);
    f.at(base); f.beforePage(() => {}); assert.equal((await f.step())?.state, 'uploading'); assert.equal(f.counts().creates, 1);
  } finally { f.cleanup(); }
});

test('clock rollback during final status lookup defers publication after its durable publishing fence', async () => {
  const f = fixture(600000), due = base + 600000;
  try {
    f.approve(); await f.step(); await f.step(); await f.step();
    f.at(due); f.beforeStatus(() => f.at(due - 1000));
    assert.equal((await f.step())?.state, 'staged'); assert.equal(f.record.nextPoll, due); assert.equal(f.counts().publishes, 0); assert.equal(f.record.issue, null);
    f.at(due); f.beforeStatus(() => {}); assert.equal((await f.step())?.state, 'published'); assert.equal(f.counts().publishes, 1);
  } finally { f.cleanup(); }
});

test('late restart continues the approved reservation but a lost publication response remains read-only', async () => {
  const f = fixture(600000);
  try {
    f.approve(); f.reopen(); f.at(base + 3600000); f.loseReply();
    await f.step(); await f.step(); await f.step();
    assert.equal((await f.step())?.state, 'uncertain'); assert.equal(f.record.issue, 'publish-unknown');
    f.reopen(); assert.equal(await f.step(), null); f.store.reconcile('project', f.draft.id, 1);
    assert.equal((await f.step())?.state, 'published'); assert.equal(f.counts().creates, 1); assert.equal(f.counts().publishes, 1);
  } finally { f.cleanup(); }
});

test('schedule schema keeps offsets, validates future admission and rejects malformed instants', () => {
  const scheduled = instagramMetadataSchema.parse({ kind: 'story', isAiGenerated: false, publishAt: '2030-01-01T09:10:00+09:00' });
  assert.equal(instagramNotBefore(scheduled, 'start'), base); assert.equal(instagramNotBefore(scheduled, 'publish'), base + 600000);
  validateInstagramSchedule(scheduled, base); assert.throws(() => validateInstagramSchedule(scheduled, base + 600000), /future/);
  assert.equal(instagramNotBefore({ kind: 'story', isAiGenerated: false } as { publishAt?: string }, 'publish'), null);
  for (const publishAt of ['tomorrow', '2030-01-01T09:00', '2030-02-30T00:00:00Z']) assert.equal(instagramMetadataSchema.safeParse({ kind: 'story', isAiGenerated: false, publishAt }).success, false);
});
