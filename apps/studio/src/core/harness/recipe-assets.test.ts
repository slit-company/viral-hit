import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleRecipeAssets, type RecipeInputAsset } from './recipe-assets';
import { recipeSchema } from './recipes';
import { readFileSync } from 'node:fs';

test('asset selection applies each consumer’s kind, size and native image format constraints', () => {
  const recipe = recipeSchema.parse(JSON.parse(readFileSync('../../examples/adapter-recipes/audio-gain.json', 'utf8')));
  const parameter = recipe.parameters[0]; assert.equal(parameter.type, 'asset'); if (parameter.type !== 'asset') throw Error('fixture');
  const base: RecipeInputAsset = { id: 'local-audio', type: 'audio', storageProvider: 'local', filename: 'source.wav', publicUrl: '/media', mimeType: 'audio/wav', sizeBytes: 1000 };
  const options = eligibleRecipeAssets(recipe, parameter, [base, { ...base, id: 'image', type: 'image' }, { ...base, id: 'remote', storageProvider: 's3' }, { ...base, id: 'large', sizeBytes: 2001 }], [{ operation: 'ext.audio-gain', assetInputs: [{ id: 'source', pointer: '/sourceAssetId', kind: 'audio', maxBytes: 2000 }] }]);
  assert.deepEqual(options.map(a => a.id), ['local-audio']);
  const native = recipeSchema.parse(JSON.parse(readFileSync('../../recipes/local-image-resize.json', 'utf8')));
  const imageParameter = native.parameters.find(p => p.type === 'asset')!; if (imageParameter.type !== 'asset') throw Error('fixture');
  const png = { ...base, type: 'image', mimeType: 'image/png' };
  assert.equal(eligibleRecipeAssets(native, imageParameter, [png, { ...png, mimeType: 'image/gif' }, { ...png, sizeBytes: 33 * 1024 * 1024 }], []).length, 1);
});

test('model recipes only offer project originals within the generation source byte limit', () => {
  const recipe = recipeSchema.parse({ schemaVersion: 1, id: 'model-sources', version: '1.0.0', title: 'Model sources', description: 'Input bounds', author: 'Test', license: 'MIT', category: 'test', parameters: [{ id: 'source', label: 'Source', type: 'asset', kind: 'video' }], nodes: [{ id: 'model', operation: 'generation.model', version: '1', input: {}, parameters: [{ parameter: 'source', target: '/references/0/assetId' }] }] });
  const parameter = recipe.parameters[0]; if (parameter.type !== 'asset') throw Error('fixture');
  const asset: RecipeInputAsset = { id: 'video', type: 'video', storageProvider: 'local', filename: 'source.mp4', publicUrl: '/media', mimeType: 'video/mp4', sizeBytes: 64 * 1024 * 1024 };
  assert.deepEqual(eligibleRecipeAssets(recipe, parameter, [asset, { ...asset, id: 'too-big', sizeBytes: asset.sizeBytes! + 1 }], []).map(a => a.id), ['video']);
});
