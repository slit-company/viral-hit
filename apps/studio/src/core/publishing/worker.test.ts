import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationStore } from './store.server';
import { runPublicationStep, type PublicationRuntime } from './worker.server';
import { PublicationStartError, type PublicationConnector, type PublicationSpec } from './contracts';

const spec: PublicationSpec = {
  schemaVersion: 1, projectId: 'project', connector: 'fixture', connectorVersion: '1', accountId: 'account', destinationId: 'channel',
  assets: [{ assetId: 'asset', sha256: 'a'.repeat(64), sizeBytes: 10, contentType: 'video/mp4' }], metadata: {},
};
function setup() {
  let now = 1000, starts = 0, transfers = 0, inspections = 0, validations = 0, reads = 0;
  const store = new PublicationStore(':memory:', () => now);
  const draft = store.create(spec, 'one');
  const connector: PublicationConnector = {
    id: 'fixture', version: '1',
    async start() { starts++; assert.equal(store.get('project', draft.id)?.state, 'starting'); return { session: 'original' }; },
    async transfer(_spec, checkpoint, read) {
      transfers++; assert.deepEqual(checkpoint, { session: 'original' });
      await read(0, 0, 10); return { kind: 'accepted', receipt: { video: 'original-video' } };
    },
    async reconcile() { return { kind: 'progress', checkpoint: { session: 'original' } }; },
    async inspect() { inspections++; return { state: 'ready', receipt: { video: 'original-video' } }; },
  };
  const runtime: PublicationRuntime = {
    async connector() { return connector; },
    async validateAssets() { validations++; },
    async read() { reads++; return new Uint8Array(10); },
  };
  return {
    store, draft, connector, runtime,
    approve: () => store.approve('project', draft.id, 1, draft.digest, 'operator'),
    tick: () => { now += 120001; },
    counts: () => ({ starts, transfers, inspections, validations, reads }),
    step: () => runPublicationStep(store, runtime),
  };
}

test('approval, starting commit, session commit, upload acceptance and remote processing are separate durable steps', async () => {
  const f = setup();
  try {
    assert.equal(await f.step(), null); f.approve();
    assert.equal((await f.step())?.state, 'uploading');
    assert.deepEqual(f.counts(), { starts: 1, transfers: 0, inspections: 0, validations: 1, reads: 0 });
    assert.equal((await f.step())?.state, 'accepted');
    f.runtime.validateAssets = async () => { throw new Error('Original source has since been removed'); };
    f.runtime.read = async () => { throw new Error('No media read is needed for a receipt'); };
    assert.equal((await f.step())?.state, 'ready');
    assert.equal(await f.step(), null);
    assert.equal(f.counts().starts, 1); assert.equal(f.counts().inspections, 1);
  } finally { f.store.close(); }
});

test('lost start reply and expired starting lease remain uncertain without another create request', async () => {
  for (const crash of [false, true]) {
    const f = setup();
    try {
      f.approve();
      if (crash) { const owner = f.store.claim()!; f.store.begin(owner); f.tick(); }
      else f.connector.start = async () => { throw new Error('Connection closed after remote creation'); };
      const record = await f.step();
      assert.equal(record?.state, 'uncertain'); assert.equal(record?.issue, 'start-unknown');
      f.tick(); assert.equal(await f.step(), null);
      assert.equal(f.counts().starts, 0); assert.equal(f.counts().transfers, 0);
    } finally { f.store.close(); }
  }
});

test('missing runtime or changed connector version never sends a request, and restored runtime continues approved intent', async () => {
  const f = setup();
  try {
    f.approve(); f.connector.version = '2';
    assert.equal((await f.step())?.issue, 'runtime-unavailable'); assert.equal(f.counts().starts, 0);
    assert.equal(await f.step(), null);
    f.connector.version = '1'; f.tick();
    assert.equal((await f.step())?.state, 'uploading'); assert.equal(f.counts().starts, 1);
  } finally { f.store.close(); }
});

test('media validation prevents creation and can recover without replacing approved identity', async () => {
  const f = setup();
  try {
    f.approve(); f.runtime.validateAssets = async () => { throw new Error('Hash mismatch'); };
    assert.equal((await f.step())?.issue, 'asset-unavailable'); assert.equal(f.counts().starts, 0);
    f.runtime.validateAssets = async () => {}; f.tick();
    assert.equal((await f.step())?.state, 'uploading'); assert.equal(f.counts().starts, 1);
  } finally { f.store.close(); }
});

test('known session retries after transient upload failure and never creates a replacement', async () => {
  const f = setup();
  try {
    f.approve(); await f.step();
    const transfer = f.connector.transfer;
    f.connector.transfer = async () => { throw new Error('Lost chunk acknowledgement'); };
    assert.equal((await f.step())?.state, 'uploading');
    assert.equal(await f.step(), null); f.tick();
    f.connector.transfer = transfer;
    assert.equal((await f.step())?.state, 'accepted'); assert.equal(f.counts().starts, 1);
  } finally { f.store.close(); }
});

test('missing media during upload pauses; read-only reconciliation does not automatically send more bytes', async () => {
  const f = setup();
  try {
    f.approve(); await f.step();
    f.runtime.read = async () => { throw new Error('Source removed'); };
    const paused = await f.step(); assert.equal(paused?.state, 'uncertain'); assert.equal(paused?.issue, 'asset-unavailable');
    f.store.reconcile('project', f.draft.id, 1);
    const result = await f.step(); assert.equal(result?.state, 'uncertain'); assert.equal(result?.issue, 'upload-incomplete');
    assert.equal(f.counts().transfers, 1);
    f.runtime.read = async () => new Uint8Array(10);
    f.store.resume('project', f.draft.id, 1);
    assert.equal((await f.step())?.state, 'accepted'); assert.equal(f.counts().starts, 1);
  } finally { f.store.close(); }
});

test('expired session stays uncertain while read-only recovery can accept the original receipt', async () => {
  const f = setup();
  try {
    f.approve(); await f.step();
    f.connector.transfer = async () => ({ kind: 'uncertain', issue: 'session-expired' });
    assert.equal((await f.step())?.issue, 'session-expired');
    assert.throws(() => f.store.resume('project', f.draft.id, 1), /original incomplete/);
    f.connector.reconcile = async () => ({ kind: 'accepted', receipt: { video: 'original' } });
    f.store.reconcile('project', f.draft.id, 1);
    assert.equal((await f.step())?.state, 'accepted'); assert.equal(f.counts().starts, 1);
  } finally { f.store.close(); }
});

test('confirmed pre-creation failures can be retried, explicit rejection is terminal', async () => {
  const f = setup();
  try {
    f.approve(); f.connector.start = async () => { throw new PublicationStartError('unavailable'); };
    assert.equal((await f.step())?.state, 'approved'); f.tick();
    f.connector.start = async () => { throw new PublicationStartError('rejected'); };
    const rejected = await f.step(); assert.equal(rejected?.state, 'failed'); assert.equal(rejected?.issue, 'remote-rejected');
    assert.equal(await f.step(), null);
  } finally { f.store.close(); }
});

test('stop during start fences late checkpoint; stop during validation prevents any remote creation', async () => {
  for (const phase of ['start', 'validation']) {
    const f = setup();
    try {
      f.approve();
      if (phase === 'start') f.connector.start = async () => { f.store.stop('project', f.draft.id, 1); return { session: 'late' }; };
      else f.runtime.validateAssets = async () => { f.store.stop('project', f.draft.id, 1); };
      const record = await f.step();
      assert.equal(record?.state, phase === 'start' ? 'uncertain' : 'canceled'); assert.equal(record?.checkpoint, null);
      assert.equal(f.counts().transfers, 0); assert.equal(await f.step(), null);
    } finally { f.store.close(); }
  }
});
