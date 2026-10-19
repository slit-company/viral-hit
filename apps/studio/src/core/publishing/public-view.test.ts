import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicationStore } from './store.server';
import { publicationView } from './public-view';
import type { PublicationSpec } from './contracts';

const spec: PublicationSpec = {
  schemaVersion: 1, projectId: 'project', connector: 'youtube', connectorVersion: '1', accountId: 'account', destinationId: 'channel',
  assets: [{ assetId: 'asset', sha256: 'a'.repeat(64), sizeBytes: 10, contentType: 'video/mp4' }],
  metadata: { title: 'Reviewed', description: '', categoryId: '22', privacy: 'private', tags: [], madeForKids: false, containsSyntheticMedia: true, notifySubscribers: false },
};
test('public projection allowlists receipts and bounded progress without sessions, leases or provider secrets', () => {
  const store = new PublicationStore(':memory:');
  try {
    const draft = store.create(spec, 'one');
    const record = { ...draft, checkpoint: { sessionUrl: 'private-session', nextByte: 5 }, leaseToken: 'private-lease', receipt: {
      videoId: 'testVideo01', channelId: 'channel', privacy: 'private', uploadStatus: 'processed', secret: 'private-provider-body',
    } };
    const view = publicationView(record), json = JSON.stringify(view);
    assert.equal(view.bytesAccepted, 5); assert.equal(view.delivery?.url, 'https://www.youtube.com/watch?v=testVideo01');
    for (const secret of ['private-session', 'private-lease', 'private-provider-body', 'checkpoint', 'leaseToken']) assert.equal(json.includes(secret), false);
    assert.equal(publicationView({ ...record, checkpoint: { nextByte: 11 } }).bytesAccepted, null);
    assert.equal(publicationView({ ...record, receipt: { ...record.receipt, channelId: 'another' } }).delivery, null);
    assert.equal(publicationView({ ...record, receipt: { ...record.receipt, videoId: '../secret' } }).delivery, null);
    const unknown = publicationView({ ...record, spec: { ...spec, connectorVersion: 'future', metadata: { secret: 'private-metadata' } } });
    assert.equal(unknown.supported, false); assert.equal(unknown.asset, null); assert.equal(unknown.metadata, null);
    assert.equal(unknown.delivery, null); assert.equal(unknown.actions.approve, false);
    assert.equal(JSON.stringify(unknown).includes('private-metadata'), false);
  } finally { store.close(); }
});
