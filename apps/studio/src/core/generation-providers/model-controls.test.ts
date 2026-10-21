import test from 'node:test';
import assert from 'node:assert/strict';
import { modelControlsSchema, resolveModelOptions, draftModelOptions, modelOptionsDraftSchema } from './model-controls';
import { providerManifestSchema } from './installed/manifest';
import { InstalledProviderAdapter, InstalledProviderRuntime } from './installed/runtime.server';
import type { EffectRecord } from '../adapters/base-adapter';

const controls = modelControlsSchema.parse([
  { key: 'title', label: 'Title', type: 'string', maxLength: 20, default: 'Review' },
  { key: 'count', label: 'Samples', type: 'number', min: 1, max: 12, integer: true, default: 3 },
  { key: 'detail', label: 'Detail', type: 'select', choices: [{ value: 'short', label: 'Short' }, { value: 'full', label: 'Full' }], default: 'short' },
  { key: 'audio', label: 'Audio', type: 'boolean', default: true },
]);
test('model options retain typed values, resolve defaults and reject invalid or undeclared inputs', () => {
  assert.deepEqual(resolveModelOptions(controls, { count: 5, audio: false }), { title: 'Review', count: 5, detail: 'short', audio: false });
  for (const invalid of [{ count: '5' }, { count: 2.5 }, { count: 13 }, { count: NaN }, { audio: 'false' }, { title: 'x'.repeat(21) }, { detail: 'unknown' }, { callbackUrl: 'https://example.com' }, null, []]) assert.throws(() => resolveModelOptions(controls, invalid));
  assert.throws(() => resolveModelOptions(undefined, { count: 5 }));
  assert.throws(() => resolveModelOptions(controls, JSON.parse('{"__proto__":true}')));
  assert.deepEqual(resolveModelOptions(undefined, undefined), {});
});
test('control definitions reject ambiguous names, invalid defaults and excessive shape without changing legacy manifests', () => {
  for (const invalid of [[controls[0], controls[0]], [{ ...controls[1], default: 13 }], [{ ...controls[1], min: 20 }], [{ ...controls[0], maxLength: 1 }], [{ ...controls[2], default: 'unknown' }], [{ ...controls[0], key: 'constructor' }], Array(17).fill(controls[0])]) assert.equal(modelControlsSchema.safeParse(invalid).success, false);
  const manifest = providerManifestSchema.parse({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'control-test', label: 'Controls', models: [{ id: 'controlled-review', name: 'Review', kind: 'analysis' }] });
  assert.equal(Object.hasOwn(manifest.models[0], 'controls'), false);
});
test('draft options are model-scoped and transport retains bounded values', () => {
  const modelOptions = { modelId: 'model-a', values: { count: 7, audio: false } };
  assert.deepEqual(modelOptionsDraftSchema.parse(modelOptions), modelOptions);
  assert.deepEqual(draftModelOptions({ modelId: 'model-a', modelOptions }), { provider_options: modelOptions.values });
  assert.deepEqual(draftModelOptions({ modelId: 'model-b', modelOptions }), {});
});
test('installed execution validates options before module import and only passes declared values', async () => {
  const manifest = providerManifestSchema.parse({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'control-test', label: 'Controls', models: [{ id: 'controlled-review', name: 'Review', kind: 'analysis', controls }] });
  const effect = { linkName: 'controlled-review', type: 3 } as EffectRecord;
  const source = `export async function createGeneration({input}) { if (input.provider_options || input._secret) throw Error('Internal field exposed'); return {status:'succeeded',text:JSON.stringify(input.options)}; }`;
  const adapter = new InstalledProviderAdapter(effect, new InstalledProviderRuntime(manifest, source));
  const input = { prompt: 'Review', video_url: 'https://example.com/a.mp4', provider_options: { count: 8, audio: false }, _secret: 'private' };
  const result = await adapter.createGeneration(input);
  assert.deepEqual(JSON.parse((result.output as {analysis_text: string}).analysis_text), { title: 'Review', count: 8, detail: 'short', audio: false });
  const failing = new InstalledProviderAdapter(effect, new InstalledProviderRuntime(manifest, `throw Error('Module must not load');`));
  assert.throws(() => failing.createGeneration({ ...input, provider_options: { unknown: true } }), /Unknown model option/);
});
