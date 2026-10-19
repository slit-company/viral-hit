import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationStore } from './store.server';
import { runPublicationStep } from './worker.server';
import { PublicationPublishError, type PublicationConnector, type PublicationSpec, type RemoteObservation } from './contracts';

const spec: PublicationSpec = { schemaVersion: 1, projectId: 'project', connector: 'fixture', connectorVersion: '1', accountId: 'account', destinationId: 'destination', assets: [{ assetId: 'asset', sha256: 'a'.repeat(64), sizeBytes: 10, contentType: 'video/mp4' }], metadata: {} };
function setup() {
  let now = 1000, publishes = 0;
  const store = new PublicationStore(':memory:', () => now), draft = store.create(spec, 'one'), receipt = { container: 'original' };
  const connector: PublicationConnector = {
    id: 'fixture', version: '1',
    async start() { return { session: 'original' }; },
    async transfer() { return { kind: 'accepted', receipt }; },
    async reconcile() { return { kind: 'accepted', receipt }; },
    async inspect() { return { state: 'staged', receipt }; },
    async publish() { publishes++; assert.equal(store.get('project', draft.id)?.state, 'publishing'); return { state: 'published', receipt: { ...receipt, post: 'original-post' } }; },
  };
  const runtime = { async connector() { return connector; }, async validateAssets() {}, async read() { throw new Error('No extra media reads'); } };
  const step = () => runPublicationStep(store, runtime);
  return { store, draft, connector, runtime, receipt, step,
    publishes: () => publishes, tick: () => { now += 120001; },
    async stage() { store.approve('project', draft.id, 1, draft.digest, 'operator'); await step(); await step(); await step(); now += 120001; },
  };
}

test('container acceptance, readiness, durable publication fence and published receipt are separate steps', async () => {
  const f = setup();
  try {
    await f.stage(); assert.equal(f.store.get('project', f.draft.id)?.state, 'staged'); assert.equal(f.publishes(), 0);
    assert.equal((await f.step())?.state, 'published'); assert.equal(f.publishes(), 1); assert.equal(await f.step(), null);
    assert.deepEqual(f.store.events('project', f.draft.id).map(e => e.state), ['draft', 'approved', 'starting', 'uploading', 'accepted', 'staged', 'publishing', 'published']);
  } finally { f.store.close(); }
});

test('lost publish reply and crashed publishing lease never trigger a second publish', async () => {
  for (const crash of [false, true]) {
    const f = setup();
    try {
      await f.stage();
      if (crash) { const owner = f.store.claim()!; assert.equal(f.store.beginPublish(owner), true); f.tick(); }
      else f.connector.publish = async () => { throw new Error('Lost response'); };
      const record = await f.step(); assert.equal(record?.state, 'uncertain'); assert.equal(record?.issue, 'publish-unknown'); assert.deepEqual(record?.receipt, f.receipt);
      f.tick(); assert.equal(await f.step(), null); f.store.reconcile('project', f.draft.id, 1);
      assert.equal((await f.step())?.state, 'uncertain'); assert.throws(() => f.store.resume('project', f.draft.id, 1), /original incomplete/); assert.equal(f.publishes(), 0);
      f.connector.inspect = async () => ({ state: 'published', receipt: { ...f.receipt, status: 'PUBLISHED' } });
      f.store.reconcile('project', f.draft.id, 1); assert.equal((await f.step())?.state, 'published'); assert.equal(f.publishes(), 0);
    } finally { f.store.close(); }
  }
});

test('reconciliation stays read-only across accepted container and multiple processing polls', async () => {
  const f = setup();
  try {
    f.store.approve('project', f.draft.id, 1, f.draft.digest, 'operator'); await f.step();
    f.store.stop('project', f.draft.id, 1); f.store.reconcile('project', f.draft.id, 1);
    assert.equal((await f.step())?.state, 'reconciling');
    f.connector.inspect = async () => ({ state: 'processing', receipt: f.receipt });
    assert.equal((await f.step())?.state, 'reconciling'); f.tick(); assert.equal((await f.step())?.state, 'reconciling'); f.tick();
    f.connector.inspect = async () => ({ state: 'staged', receipt: f.receipt });
    assert.equal((await f.step())?.state, 'uncertain'); f.tick(); assert.equal(await f.step(), null); assert.equal(f.publishes(), 0);
  } finally { f.store.close(); }
});

test('non-terminal publish results cannot loop back into another publish', async () => {
  for (const state of ['processing', 'scheduled', 'staged'] as const) {
    const f = setup();
    try {
      await f.stage(); let writes = 0;
      f.connector.publish = async (): Promise<RemoteObservation> => { writes++; return { state, receipt: f.receipt }; };
      assert.equal((await f.step())?.state, state === 'staged' ? 'uncertain' : 'reconciling'); f.tick(); await f.step(); f.tick(); await f.step(); assert.equal(writes, 1);
    } finally { f.store.close(); }
  }
});

test('only explicit pre-write unavailability can retry final publication', async () => {
  const f = setup();
  try {
    await f.stage(); f.connector.publish = async () => { throw new PublicationPublishError('unavailable'); };
    assert.equal((await f.step())?.state, 'staged'); assert.equal(await f.step(), null); f.tick();
    f.connector.publish = async () => { throw new PublicationPublishError('rejected'); };
    assert.equal((await f.step())?.state, 'failed'); assert.equal(await f.step(), null);
  } finally { f.store.close(); }
});

test('stop before fence prevents write, stop during publish quarantines late response', async () => {
  for (const before of [true, false]) {
    const f = setup();
    try {
      await f.stage(); let writes = 0;
      if (before) f.runtime.connector = async () => { f.store.stop('project', f.draft.id, 1); return f.connector; };
      else f.connector.publish = async () => { writes++; f.store.stop('project', f.draft.id, 1); return { state: 'published', receipt: { late: true } }; };
      const record = await f.step(); assert.equal(record?.state, 'uncertain'); assert.equal(record?.issue, 'stopped'); assert.deepEqual(record?.receipt, f.receipt); assert.equal(writes, before ? 0 : 1);
      f.store.reconcile('project', f.draft.id, 1); assert.equal(await f.step(), null); f.tick(); f.runtime.connector = async () => f.connector;
      assert.equal((await f.step())?.state, 'uncertain'); assert.equal(writes, before ? 0 : 1);
    } finally { f.store.close(); }
  }
});

test('publishing fence survives SQLite reopen, and obsolete lease cannot overwrite recovery', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'viral-hit-publish-fence-')); let now = 1000;
  let store = new PublicationStore(join(root, 'queue.sqlite'), () => now);
  try {
    const draft = store.create(spec, 'one'); store.approve('project', draft.id, 1, draft.digest, 'operator');
    const preparing = store.claim()!; store.begin(preparing); store.finish(preparing, 'staged', { receipt: { container: 'original' } });
    const old = store.claim()!; assert.equal(store.beginPublish(old), true); store.close();
    store = new PublicationStore(join(root, 'queue.sqlite'), () => now);
    assert.equal(store.claim(), null); now += 120001;
    const result = await runPublicationStep(store, { async connector() { throw new Error('Must recover before runtime lookup'); }, async read() { throw new Error('No reads'); }, async validateAssets() {} });
    assert.equal(result?.state, 'uncertain'); assert.equal(result?.issue, 'publish-unknown');
    assert.equal(store.finish(old, 'published', { receipt: { wrong: true } }), false);
    assert.deepEqual(store.get('project', draft.id)?.receipt, { container: 'original' });
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
