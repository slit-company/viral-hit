import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisInputsSchema, resolveAnalysisInputs, singleAnalysisVideo } from './analysis-inputs';
import { validateInstalledAnalysisInput } from './installed/analysis-input';
import { providerManifestSchema } from './installed/manifest';
import { InstalledProviderAdapter, InstalledProviderRuntime } from './installed/runtime.server';
import type { EffectRecord } from '../adapters/base-adapter';

const inputs = { image: { min: 0, max: 2 }, video: { min: 0, max: 2 }, audio: { min: 0, max: 2 } };
const image = 'https://example.com/a.png', video = 'https://example.com/b.mp4', audio = 'https://example.com/c.wav';
const definition = { schemaVersion: 1, kind: 'viral-hit-provider', id: 'multi-test', label: 'Multi', models: [{ id: 'multi-review', name: 'Review', kind: 'analysis', analysisInputs: inputs }] };

test('analysis declarations are bounded and omitted legacy fields preserve normalized manifests', () => {
  const manifest = providerManifestSchema.parse(definition);
  assert.deepEqual(manifest.models[0].analysisInputs, inputs);
  const { analysisInputs: _, ...legacyModel } = definition.models[0];
  const legacy = providerManifestSchema.parse({ ...definition, models: [legacyModel] });
  assert.equal('analysisInputs' in legacy.models[0], false);
  assert.deepEqual(resolveAnalysisInputs(), { image: { min: 0, max: 0 }, video: { min: 1, max: 1 }, audio: { min: 0, max: 0 } });
  for (const bad of [{ ...inputs, image: { min: 3, max: 2 } }, { ...inputs, image: { min: 0, max: 20 } }, { image: { min: 0, max: 0 }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 } }]) assert.throws(() => analysisInputsSchema.parse(bad));
  assert.throws(() => providerManifestSchema.parse({ ...definition, models: [{ ...definition.models[0], kind: 'image', aspectRatios: ['1:1'] }] }));
});

test('typed input counts cannot be bypassed by aliases, duplicate URLs, wrong types or an empty batch', () => {
  const mixed = { prompt: 'Review together', image_urls: [image], video_urls: [video], audio_urls: [audio] };
  assert.deepEqual(validateInstalledAnalysisInput(mixed, inputs), mixed);
  for (const input of [{ prompt: 'Empty' }, { ...mixed, video_url: audio }, { ...mixed, image_urls: [image, image] }, { ...mixed, audio_urls: [image] }, { ...mixed, image_urls: [image, audio, video] }, { ...mixed, audio_urls: ['not a URL'] }, { ...mixed, image_url: image }, { ...mixed, video_urls: [video, audio], video_url: video }]) assert.throws(() => validateInstalledAnalysisInput(input, inputs));
  assert.throws(() => validateInstalledAnalysisInput(mixed));
  assert.throws(() => validateInstalledAnalysisInput({ prompt: 'Review', image_urls: [image] }, { ...inputs, image: { min: 2, max: 2 } }));
  assert.doesNotThrow(() => validateInstalledAnalysisInput({ prompt: 'Legacy', video_url: video, video_urls: [video] }));
});

test('timed storyboard handoff only admits one unambiguous video timeline', () => {
  assert.equal(singleAnalysisVideo({ video_url: video }), video);
  assert.equal(singleAnalysisVideo({ video_urls: [video] }), video);
  for (const source of [{ video_url: video, image_urls: [image] }, { video_urls: [video], audio_urls: [audio] }, { video_urls: [video, audio] }, { video_url: video, video_urls: [audio] }]) assert.equal(singleAnalysisVideo(source), null);
});

test('executable boundary validates before importing and queued mixed-input jobs retain their task contract after recreation', async () => {
  const manifest = providerManifestSchema.parse(definition);
  const effect = { linkName: 'multi-review', type: 3 } as EffectRecord;
  const invalid = new InstalledProviderAdapter(effect, new InstalledProviderRuntime(manifest, 'throw Error("Module must not load");'));
  assert.throws(() => invalid.createGeneration({ prompt: 'Invalid', audio_urls: [audio, audio] }), /distinct/);
  const source = `export async function createGeneration({input}) {
    if(input.videoUrl || input._secret || input.imageUrls.length!==1 || input.videoUrls.length!==2 || input.audioUrls.length!==1)throw Error('Projection failed');
    return {status:'processing',taskId:'mixed-1-2-1'};
  }
  export async function checkStatus(request) {
    if(request.input || request.readMedia || request.media || request.taskId!=='mixed-1-2-1')throw Error('Polling contract changed');
    return {status:'succeeded',text:'Recovered mixed-input receipt'};
  }`;
  const adapter = new InstalledProviderAdapter(effect, new InstalledProviderRuntime(manifest, source, true));
  const result = await adapter.createGeneration({ prompt: 'Review', image_urls: [image], video_urls: [video, 'https://example.com/second.mp4'], audio_urls: [audio], _secret: 'not public' });
  assert.equal(result.status, 'processing');
  const resumed = new InstalledProviderAdapter(effect, new InstalledProviderRuntime(manifest, source, true));
  const taskId = (result.output as { taskId: string }).taskId;
  assert.match(taskId, /^vh-runtime-v1:/);
  assert.equal((await resumed.checkStatus(taskId)).status, 'succeeded');
  const changed = providerManifestSchema.parse({ ...definition, models: [{ ...definition.models[0], analysisInputs: { ...inputs, audio: { min: 0, max: 1 } } }] });
  await assert.rejects(new InstalledProviderAdapter(effect, new InstalledProviderRuntime(changed, source, true)).checkStatus(taskId), /Restore the original runtime/);
});
