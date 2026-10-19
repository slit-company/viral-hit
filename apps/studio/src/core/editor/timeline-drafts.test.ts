import assert from 'node:assert/strict';
import test from 'node:test';
import { addSourceClip, createTimelineDocument } from './timeline-document';
import { TimelineDraftJournal, mergeTimelineDraft } from './timeline-drafts';

class MemoryStorage {
  data = new Map<string, string>(); fail = false;
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error('Quota exceeded'); this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
const fixture = () => addSourceClip(createTimelineDocument({ projectId: 'project-1', name: 'A film' }), { clipId: 'opening', assetId: 'image', sourceUrl: '/opening.png', name: 'Opening', sourceType: 'image', sourceDuration: 3 });

test('independent tab drafts survive reopen and deleting an old snapshot cannot remove newer work', () => {
  const storage = new MemoryStorage(), a = new TimelineDraftJournal(storage, 'project-1', 'tab-a'), b = new TimelineDraftJournal(storage, 'project-1', 'tab-b');
  const base = fixture(), first = a.write(base, { ...base, name: 'A edit' }, 2), second = b.write(base, { ...base, name: 'B edit' }, 2);
  assert.equal(a.write(base, { ...base, name: 'A edit' }, 2).serialized, first.serialized);
  const reopened = new TimelineDraftJournal(storage, 'project-1', 'after-reload');
  assert.equal(reopened.list().records.length, 2); assert.equal(new TimelineDraftJournal(storage, 'another-project', 'tab').list().records.length, 0);
  const newer = a.write(base, { ...base, name: 'A newer edit' }, 2);
  assert.equal(reopened.remove(first), false); assert.equal(reopened.remove(second), true);
  assert.equal(reopened.list().records[0].draft.document.name, 'A newer edit'); assert.equal(reopened.remove(newer), true);
});

test('invalid and cross-project drafts are retained without recovery; quota failure preserves the last backup', () => {
  const storage = new MemoryStorage(), journal = new TimelineDraftJournal(storage, 'project-1', 'tab');
  const base = fixture(), saved = journal.write(base, { ...base, name: 'Keep me' }, 1);
  storage.fail = true; assert.throws(() => journal.write(base, { ...base, name: 'Too late' }, 1), /Quota/);
  assert.equal(journal.list().records[0].serialized, saved.serialized); storage.fail = false;
  const key = storage.key(0)!;
  storage.setItem(key + 'broken', '{bad');
  storage.setItem(key + 'foreign', JSON.stringify({ ...saved.draft, id: 'tabforeign', document: { ...base, projectId: 'another-project' } }));
  assert.equal(journal.list().unreadable, 2); assert.equal(storage.length, 3);
  assert.throws(() => journal.write(base, { ...base, projectId: 'wrong' }, 1), /project id/);
  assert.equal(storage.getItem(key), saved.serialized);
});

test('recovery combines disjoint edits, invalidates stale exports and reports real conflicts without mutating snapshots', () => {
  const storage = new MemoryStorage(), journal = new TimelineDraftJournal(storage, 'project-1', 'tab');
  const base = fixture(), local = structuredClone(base), remote = structuredClone(base);
  local.tracks[0].clips[0].name = 'Local opening'; remote.name = 'Remote film'; remote.lastRenderAssetId = 'old-export'; remote.lastRenderUrl = '/old.mp4';
  const record = journal.write(base, local, 1), merged = mergeTimelineDraft(record.draft, { document: remote, version: 2 });
  assert.deepEqual(merged.conflicts, []); assert.equal(merged.document.name, 'Remote film'); assert.equal(merged.document.tracks[0].clips[0].name, 'Local opening');
  assert.equal(merged.document.lastRenderAssetId, null); assert.equal(merged.version, 2);
  remote.tracks[0].clips[0].name = 'Remote opening';
  assert.match(mergeTimelineDraft(record.draft, { document: remote, version: 3 }).conflicts[0].path, /name$/);
  assert.equal(journal.list().records[0].serialized, record.serialized); assert.equal(remote.tracks[0].clips[0].name, 'Remote opening');
  assert.throws(() => mergeTimelineDraft(record.draft, null), /missing/);
  assert.deepEqual(mergeTimelineDraft({ ...record.draft, baseVersion: 0 }, null).conflicts, []);
});
