import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicationStore } from './store.server';
import { publicPublication, type PublicationSpec } from './contracts';

const spec: PublicationSpec = {
  schemaVersion: 1, projectId: 'project', connector: 'example', connectorVersion: '1', accountId: 'account', destinationId: 'channel',
  assets: [{ assetId: 'asset', sha256: 'a'.repeat(64), sizeBytes: 10, contentType: 'video/mp4' }], metadata: { title: 'Reviewed' },
};

test('canonical intent, idempotency, revision approval, project boundaries and redacted views survive reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publication-')), file = join(dir, 'jobs.sqlite');
  let store = new PublicationStore(file);
  try {
    const created = store.create(spec, 'request');
    assert.equal(store.create({ ...spec, metadata: { title: 'Reviewed' } }, 'request').id, created.id);
    assert.throws(() => store.create({ ...spec, accountId: 'other' }, 'request'), /different content/);
    assert.equal(store.get('another-project', created.id), null);
    assert.throws(() => store.approve('another-project', created.id, 1, created.digest, 'operator'), /not found/);
    assert.throws(() => store.approve('project', created.id, 2, created.digest, 'operator'), /revision/);
    assert.throws(() => store.approve('project', created.id, 1, 'b'.repeat(64), 'operator'), /changed/);
    store.approve('project', created.id, 1, created.digest, 'operator');
    const revised = store.revise('project', created.id, 1, { ...spec, metadata: { title: 'Changed' } });
    assert.equal(revised.state, 'draft'); assert.equal(revised.revision, 2); assert.equal(revised.approval, null);
    assert.notEqual(revised.digest, created.digest);
    assert.equal(store.create(spec, 'request').revision, 2);
    store.approve('project', created.id, 2, revised.digest, 'operator');
    const claim = store.claim()!;
    assert.equal(store.begin(claim), true);
    assert.throws(() => store.revise('project', created.id, 2, spec), /immutable/);
    store.checkpoint(claim, { sessionUrl: 'private-session' });
    store.close(); store = new PublicationStore(file);
    const reopened = store.get('project', created.id)!;
    assert.equal(reopened.state, 'uploading'); assert.deepEqual(reopened.checkpoint, { sessionUrl: 'private-session' });
    assert.equal(reopened.approval?.digest, revised.digest);
    const view = publicPublication(reopened);
    for (const key of ['checkpoint', 'receipt', 'leaseToken', 'leaseUntil']) assert.equal(key in view, false);
    assert.equal(JSON.stringify(view).includes('private-session'), false);
    assert.deepEqual(store.events('project', created.id).map(row => row.state), ['draft', 'approved', 'draft', 'approved', 'starting', 'uploading']);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('leases fence stale writers and stopped work cannot reconcile while original I/O is in flight', () => {
  let now = 1000;
  const store = new PublicationStore(':memory:', () => now);
  try {
    const draft = store.create(spec, 'one'); store.approve('project', draft.id, 1, draft.digest, 'operator');
    const first = store.claim()!;
    assert.equal(store.claim(), null); store.begin(first); store.checkpoint(first, { sessionUrl: 'original' });
    const active = store.claim()!;
    assert.equal(store.stop('project', draft.id, 1).state, 'uncertain');
    assert.equal(store.finish(active, 'published', { receipt: { id: 'stale' } }), false);
    store.reconcile('project', draft.id, 1);
    assert.equal(store.claim(), null);
    now += 120001;
    const fresh = store.claim()!;
    assert.equal(fresh.state, 'reconciling');
    assert.equal(store.finish(active, 'uploading'), false);
    store.finish(fresh, 'uncertain', { issue: 'upload-incomplete', checkpoint: { sessionUrl: 'original', nextByte: 5 } });
    store.resume('project', draft.id, 1);
    const resumed = store.claim()!;
    assert.deepEqual(resumed.checkpoint, { sessionUrl: 'original', nextByte: 5 });
    now += 120001;
    assert.equal(store.finish(resumed, 'published'), false);
    assert.ok(store.claim());
  } finally { store.close(); }
});

test('drafts require approval; uncertain or expired sessions cannot silently create a new upload', () => {
  const store = new PublicationStore(':memory:');
  try {
    const draft = store.create(spec, 'one');
    assert.equal(store.claim(), null);
    assert.throws(() => store.reconcile('project', draft.id, 1), /No original/);
    assert.throws(() => store.resume('project', draft.id, 1), /original incomplete/);
    store.approve('project', draft.id, 1, draft.digest, 'operator');
    const claim = store.claim()!; store.begin(claim); store.finish(claim, 'uncertain', { issue: 'start-unknown' });
    assert.equal(store.claim(), null);
    assert.throws(() => store.approve('project', draft.id, 1, draft.digest, 'operator'), /Only a draft/);
    assert.throws(() => store.revise('project', draft.id, 1, spec), /immutable/);
    assert.throws(() => store.reconcile('project', draft.id, 1), /No original/);
  } finally { store.close(); }
});

test('bounded valid contracts and canonical ordering bind every material publication choice', () => {
  const store = new PublicationStore(':memory:');
  try {
    const base = { ...spec, metadata: { title: 'x', description: 'y' } };
    const original = store.create(base, 'one');
    assert.equal(store.create({ ...spec, metadata: { description: 'y', title: 'x' } }, 'one').digest, original.digest);
    let key = 0;
    for (const change of [{ destinationId: 'other' }, { connectorVersion: '2' }, { accountId: 'other' }, { assets: [{ ...spec.assets[0], sha256: 'b'.repeat(64) }] }]) {
      assert.notEqual(store.create({ ...base, ...change }, `choice-${++key}`).digest, original.digest);
    }
    assert.throws(() => store.create({ ...spec, metadata: 'x'.repeat(128001) }, 'large'), /128 KB/);
    assert.throws(() => store.create({ ...spec, assets: [{ ...spec.assets[0], sizeBytes: -1 }] }, 'negative'));
    assert.throws(() => store.create({ ...spec, credential: 'secret' }, 'extra'));
  } finally { store.close(); }
});

test('repeated unchanged probes do not grow the event log', () => {
  const store = new PublicationStore(':memory:');
  try {
    const draft = store.create(spec, 'one'); store.approve('project', draft.id, 1, draft.digest, 'operator');
    const first = store.claim()!; store.begin(first); store.checkpoint(first, { session: 'one', nextByte: 0 });
    for (let nextByte = 0; nextByte < 100; nextByte++) store.finish(store.claim()!, 'uploading', { checkpoint: { session: 'one', nextByte } });
    assert.equal(store.events('project', draft.id).length, 4);
  } finally { store.close(); }
});
