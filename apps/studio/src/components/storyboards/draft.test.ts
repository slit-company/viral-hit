import test from 'node:test';
import assert from 'node:assert/strict';
import { newDraft, readDraft, readPending, planToSave } from './draft';

test('incomplete storyboard intent, observation ranges and decision lines survive a local reload', () => {
  const draft = newDraft();
  draft.plan.title = '';
  draft.plan.references = [{ id: 'ref-one', assetId: 'owned', sha256: 'a'.repeat(64), observation: '', basis: 'proposed', startTime: 2, endTime: 1 }];
  draft.plan.shots[0].title = '';
  draft.plan.shots[0].preserve = ['Original silhouette', ''];
  assert.deepEqual(readDraft(JSON.stringify(draft)), draft);
  const saved = planToSave(draft.plan);
  assert.deepEqual(saved.shots[0].preserve, ['Original silhouette']);
  assert.deepEqual(draft.plan.shots[0].preserve, ['Original silhouette', '']);
  assert.throws(() => readDraft(JSON.stringify({ ...draft, revision: -1 })));
  assert.throws(() => readDraft(JSON.stringify({ ...draft, plan: { ...draft.plan, shots: [{}] } })));
});

test('pending execution identity and original revision survive serialization; other mutations cannot be restored as executions', () => {
  const action = { action: 'generate', id: 'board-one', expectedRevision: 3, shotId: 'opening', requestId: crypto.randomUUID() };
  assert.deepEqual(readPending(JSON.stringify(action)), action);
  assert.throws(() => readPending(JSON.stringify({ action: 'read', id: action.id })));
  assert.throws(() => readPending(JSON.stringify({ ...action, requestId: 'not-an-id' })));
});
