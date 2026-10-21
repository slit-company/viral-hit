import test from 'node:test';
import assert from 'node:assert/strict';
import { newStudioAudioDraft, restoreStudioAudioHistory, studioAudioDraftSchema, studioAudioRequest } from './studio-audio';
import type { ProjectGenerationItem } from '../effects/project-generations';

const model = { id: 'independent-audio', name: 'Independent audio', uploadPath: '', imageBucketName: '', available: true };
test('audio drafts keep exact model options and reject missing models without visual parameters or references', () => {
  const draft = { ...newStudioAudioDraft(model.id, '  A short sound  '), modelOptions: { modelId: model.id, values: { voice: 'chosen', seconds: 1.5 } } };
  const restored = studioAudioDraftSchema.parse(JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(studioAudioRequest('project', restored, model), { version: 2, projectId: 'project', mode: 'audio', modelId: model.id, prompt: 'A short sound', references: [], parameters: { provider_options: { voice: 'chosen', seconds: 1.5 } } });
  for (const unavailable of [undefined, { ...model, available: false }, { ...model, id: 'other' }]) assert.throws(() => studioAudioRequest('project', draft, unavailable), /configured audio model/);
  assert.deepEqual(studioAudioRequest('project', { ...draft, modelOptions: { modelId: 'other', values: { seconds: 99 } } }, model).parameters, {});
  assert.throws(() => studioAudioRequest('project', newStudioAudioDraft(model.id, ' '), model));
  assert.throws(() => studioAudioDraftSchema.parse({ ...draft, prompt: 'x'.repeat(5001) }));
});

test('audio history reuses the original provider model and options without silently switching to an available model', () => {
  const history: ProjectGenerationItem = { id: 'audio-history', status: 'succeeded', modelName: 'Audio', resultUrl: '/sound.wav', resultText: null, paramsLabel: null, aspectRatio: null, outputQuality: null, mode: null, duration: null, referenceImages: [], referenceVideos: [], referenceAudios: [], error: null, createdAt: new Date().toISOString(), mediaType: 'audio', modelId: 'removed-audio', prompt: 'Original words', modelOptions: { modelId: 'removed-audio', values: { voice: 'speaker-a' } } };
  const restored = restoreStudioAudioHistory(history);
  assert.equal(restored.modelId, 'removed-audio'); assert.deepEqual(restored.modelOptions, history.modelOptions);
  assert.throws(() => studioAudioRequest('project', restored, model), /configured audio model/);
  assert.throws(() => restoreStudioAudioHistory({ ...history, mediaType: 'image' }));
});
