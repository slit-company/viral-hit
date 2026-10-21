import test from 'node:test';
import assert from 'node:assert/strict';
import { providerManifestSchema } from './manifest';
import { InstalledProviderRuntime, providerInput } from './runtime.server';
import type { EffectRecord } from '@/core/adapters/base-adapter';
import { validateInstalledAnalysisInput } from './analysis-input';

const manifest = providerManifestSchema.parse({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'analysis-test', label: 'Analysis', models: [{ id: 'analysis-test', name: 'Analysis test', kind: 'analysis' }] });
const effect = { linkName: 'analysis-test', type: 3 } as EffectRecord;
test('analysis results are bounded text and cannot masquerade as generated media', async () => {
  for (const result of [{ status:'succeeded' }, { status:'succeeded', text:' ' }, { status:'succeeded', text:'x'.repeat(128001) }, { status:'succeeded', media:[{url:'https://example.com/x.mp4'}] }]) {
    const runtime = new InstalledProviderRuntime(manifest, 'export async function createGeneration(){return '+JSON.stringify(result)+'}');
    assert.equal((await runtime.call('createGeneration', effect, { input:{} })).status, 'failed');
  }
  const runtime = new InstalledProviderRuntime(manifest, 'export async function createGeneration(){return {status:"succeeded",text:"Review result"}}');
  assert.deepEqual(await runtime.call('createGeneration', effect, {}), {status:'succeeded',output:{analysis_text:'Review result'}});
});
test('analysis forwards the reviewed video, depth and token budget; rejects mixed references', () => {
  const input = {prompt:'Review',video_url:'https://example.com/x.mp4',video_urls:['https://example.com/x.mp4'],analysis_depth:'deep',max_output_tokens:4096};
  assert.deepEqual(providerInput(validateInstalledAnalysisInput(input)), {prompt:'Review',imageUrls:[],videoUrl:input.video_url,videoUrls:input.video_urls,analysisDepth:'deep',maxOutputTokens:4096});
  assert.throws(() => validateInstalledAnalysisInput({...input, video_urls:['https://example.com/other.mp4']}));
  assert.throws(() => validateInstalledAnalysisInput({...input, image_urls:['https://example.com/x.png']}));
  assert.throws(() => providerManifestSchema.parse({...manifest,models:[{...manifest.models[0],durations:['5s']}]}));
  assert.throws(() => providerManifestSchema.parse({...manifest,models:[{...manifest.models[0],kind:'image'}]}));
});
