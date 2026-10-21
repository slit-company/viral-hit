import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAudioSource, newStudioAudioDraft, restoreStudioAudioHistory, studioAudioDraftSchema, studioAudioRequest } from './studio-audio';
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
  const restored = restoreStudioAudioHistory('project', history, []);
  assert.equal(restored.modelId, 'removed-audio'); assert.deepEqual(restored.modelOptions, history.modelOptions);
  assert.throws(() => studioAudioRequest('project', restored, model), /configured audio model/);
  assert.throws(() => restoreStudioAudioHistory('project', { ...history, mediaType: 'image' }, []));
});


test('declared audio sources survive model changes and legacy drafts normalize without sources', () => {
  assert.deepEqual(studioAudioDraftSchema.parse({ version: 1, modelId: model.id, prompt: 'legacy' }).sources, []);
  const referenceInputs = { image: { min: 0, max: 1 }, video: { min: 0, max: 1 }, audio: { min: 1, max: 1 } };
  const conditioned = { ...model, referenceInputs };
  const source = { id: 'audio-id', type: 'audio' as const, publicUrl: '/api/app/projects/project/assets/audio-id', filename: 'Source.wav' };
  let draft = newStudioAudioDraft(model.id, 'Process this source');
  assert.throws(() => studioAudioRequest('project', draft, conditioned), /Audio requires/);
  draft = appendAudioSource(draft, source, conditioned);
  assert.deepEqual(studioAudioRequest('project', draft, conditioned).references, [{ assetId: source.id, role: 'audio_track' }]);
  assert.throws(() => studioAudioRequest('project', draft, model), /Audio requires/);
  assert.equal(draft.sources.length, 1);
  assert.deepEqual(appendAudioSource(draft, source, conditioned), draft);
  assert.throws(() => appendAudioSource(draft, { ...source, id: 'second-audio' }, conditioned), /at most 1/);
  assert.throws(() => studioAudioRequest('project', { ...draft, sources: [source, source] }, conditioned), /distinct/);
});

test('audio history restores exact mixed source IDs beyond the library window and rejects foreign originals', () => {
  const item = { mediaType: 'audio', modelId: model.id, prompt: 'Reuse', referenceImages: ['/api/app/projects/project/assets/image-id'], referenceVideos: ['/api/app/projects/project/assets/video-id'], referenceAudios: ['/api/app/projects/project/assets/audio-id'] } as ProjectGenerationItem;
  const restored = restoreStudioAudioHistory('project', item, []);
  assert.deepEqual(restored.sources.map(source => [source.id, source.type]), [['image-id', 'image'], ['video-id', 'video'], ['audio-id', 'audio']]);
  assert.throws(() => restoreStudioAudioHistory('foreign', item, []), /another project/);
  assert.throws(() => restoreStudioAudioHistory('project', { ...item, referenceAudios: ['https://missing.invalid/a.wav'] }, []), /unavailable/);
});
