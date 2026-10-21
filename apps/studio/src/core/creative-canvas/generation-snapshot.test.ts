import test from 'node:test';
import assert from 'node:assert/strict';
import { captureGenerationSnapshot } from './generation-snapshot';
import { createStudioDraftCard } from '../studio/studio-draft';
import { normalizeProjectSnapshotCard } from '../projects/project-snapshot';
import { canvasOperationSchema } from '../commands/schema';

test('captured model options survive command/snapshot persistence independently of subsequent draft changes', () => {
  const draft = { ...createStudioDraftCard({ type: 'image', model: null }), modelId: 'independent-image', modelOptions: { modelId: 'independent-image', values: { count: 3, title: 'My scene' } } };
  const operation = canvasOperationSchema.parse({ type: 'upsert_card', card: draft });
  assert.equal(operation.type, 'upsert_card');
  assert.deepEqual(normalizeProjectSnapshotCard(draft)?.modelOptions, draft.modelOptions);
  const captured = captureGenerationSnapshot(draft, '16:9');
  draft.modelOptions.values.count = 10;
  draft.referenceCardIds.push('later-reference');
  assert.equal(captured.modelOptions?.values.count, 3);
  assert.deepEqual(captured.referenceCardIds, []);
  assert.equal(captured.aspectRatio, '16:9');
  assert.throws(() => canvasOperationSchema.parse({ type: 'upsert_card', card: { ...draft, modelOptions: { modelId: 'independent-image', values: { nested: { path: 'file' } } } } }));
});
