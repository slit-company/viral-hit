import test from 'node:test';
import assert from 'node:assert/strict';
import { toolModels, chooseToolModel, modelStudioTools } from './tools';
import { providerModelSchema } from '@/core/generation-providers/installed/manifest';

test('operations group unrelated providers by declared capability, without matching names', () => {
  const models = [
    {
      id: 'one',
      providerId: 'independent-a',
      workspaceType: 'ai-video',
      studioTasks: ['motion-control'] as const,
      available: false,
    },
    {
      id: 'two',
      providerId: 'independent-b',
      workspaceType: 'ai-video',
      studioTasks: ['motion-control'] as const,
      available: true,
    },
    {
      id: 'sume-motion-in-name-only',
      providerId: 'other',
      workspaceType: 'ai-video',
      available: true,
    },
  ];
  assert.deepEqual(
    toolModels(models, 'motion-control').map((m) => m.id),
    ['one', 'two'],
  );
  assert.equal(
    chooseToolModel(toolModels(models, 'motion-control'))?.id,
    'two',
  );
  assert.equal(
    chooseToolModel(toolModels(models, 'motion-control'), 'independent-a')?.id,
    'one',
  );
  assert.equal(toolModels(models, 'image-edit').length, 0);
  assert.deepEqual(modelStudioTools(models[2]), ['video-generate']);
  assert.equal(chooseToolModel([]), null);
});
test('manifest rejects false media declarations and duplicate tasks before model registration', () => {
  const model = {
    id: 'test-image',
    name: 'Test',
    kind: 'image',
    aspectRatios: ['1:1'],
  };
  assert.throws(() =>
    providerModelSchema.parse({ ...model, studioTasks: ['image-lipsync'] }),
  );
  assert.throws(() =>
    providerModelSchema.parse({
      ...model,
      studioTasks: ['image-edit', 'image-edit'],
    }),
  );
  assert.equal(
    providerModelSchema.parse({ ...model, studioTasks: ['image-edit'] })
      .studioTasks?.[0],
    'image-edit',
  );
});
