import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAnalysisSource, newStudioAnalysisDraft, restoreStudioAnalysisHistory, studioAnalysisDraftSchema, studioAnalysisRequest } from './studio-analysis';
import { toProjectGenerationItem } from '../effects/project-generations';

const model = { id: 'review', name: 'Review', uploadPath: '', imageBucketName: '', analysisInputs: { image: { min: 1, max: 2 }, video: { min: 0, max: 1 }, audio: { min: 1, max: 1 } } };
const image = { id: 'image-id', type: 'image' as const, publicUrl: '/api/app/projects/p/assets/image-id', filename: 'Reference.png' };
const audio = { id: 'audio-id', type: 'audio' as const, publicUrl: '/api/app/projects/p/assets/audio-id', filename: 'Speech.wav' };
const draft = { ...newStudioAnalysisDraft('review', 'Compare image and speech'), sources: [image, audio], modelOptions: { modelId: 'review', values: { framing: 'portrait' } } };

test('Studio analysis emits the selected model, all owned asset IDs and model-scoped controls through the shared generation contract', () => {
  const request = studioAnalysisRequest('p', draft, model);
  assert.equal(request.modelId, 'review'); assert.equal(request.mode, 'analysis');
  assert.deepEqual(request.references, [{ assetId: image.id, role: 'source' }, { assetId: audio.id, role: 'audio_track' }]);
  assert.deepEqual(request.parameters.provider_options, { framing: 'portrait' });
  assert.equal(request.parameters.max_output_tokens, 2048);
  assert.throws(() => studioAnalysisRequest('p', draft, undefined), /unavailable/);
  assert.throws(() => studioAnalysisRequest('p', draft, { ...model, available: false }), /unavailable/);
  assert.throws(() => studioAnalysisRequest('p', { ...draft, sources: [image] }, model), /audio references/);
  assert.throws(() => studioAnalysisRequest('p', { ...draft, sources: [image, image, audio] }, model), /distinct/);
  const switched = { ...draft, modelId: 'another-review' };
  assert.equal(studioAnalysisRequest('p', switched, { ...model, id: switched.modelId }).parameters.provider_options, undefined);
  assert.deepEqual(studioAnalysisDraftSchema.parse(JSON.parse(JSON.stringify(draft))), draft);
});

test('selection allows incremental required inputs, deduplicates membership rows and refuses excess counts without dropping existing inputs', () => {
  const initial = newStudioAnalysisDraft('review', 'Review');
  const next = appendAnalysisSource(initial, image, model);
  assert.equal(next.sources.length, 1);
  assert.equal(appendAnalysisSource(next, image, model), next);
  assert.throws(() => appendAnalysisSource(draft, { ...audio, id: 'second' }, model), /at most 1 audio/);
  assert.deepEqual(draft.sources, [image, audio]);
});

function history(input: Record<string, unknown> = {}) {
  return toProjectGenerationItem({ id: 'g', status: 'succeeded', submittedPrompt: 'Retained focus', effectId: 123,
    input: { _provider: { modelId: 'review', kind: 'analysis', name: 'Independent review' }, image_urls: [image.publicUrl], audio_urls: [audio.publicUrl], analysis_depth: 'deep', provider_options: { framing: 'portrait' }, ...input },
    output: { analysis_text: 'Measured report' }, error: null, createdAt: new Date(0) });
}

test('history projection and restoration preserve independent identity, depth, typed options and every media kind after a restart', () => {
  const item = history();
  assert.deepEqual(item.modelOptions, draft.modelOptions);
  assert.equal(item.analysisDepth, 'deep');
  const restored = restoreStudioAnalysisHistory('p', item, [image, audio, image]);
  assert.equal(restored.prompt, 'Retained focus'); assert.equal(restored.modelId, 'review');
  assert.equal(restored.depth, 'deep'); assert.deepEqual(restored.modelOptions, draft.modelOptions);
  assert.deepEqual(restored.sources, [image, audio]);
  assert.deepEqual(restoreStudioAnalysisHistory('p', item, []).sources.map(source => source.id), [image.id, audio.id]);
});

test('history never silently substitutes foreign/unavailable sources or arbitrary raw parameter objects', () => {
  assert.throws(() => restoreStudioAnalysisHistory('foreign', history(), []), /another project/);
  assert.throws(() => restoreStudioAnalysisHistory('p', history({ image_urls: ['https://unknown.invalid/input.png'] }), []), /unavailable/);
  assert.equal(history({ provider_options: { nested: { apiKey: 'not public' } } }).modelOptions, undefined);
  assert.equal(history({ provider_options: { _private: 'not public' } }).modelOptions, undefined);
});
