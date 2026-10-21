import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const directory = mkdtempSync(join(tmpdir(), 'vh-model-author-'));
process.env.VIRAL_HIT_DATA_DIR = join(directory, 'data');
process.env.VIRAL_HIT_PROVIDERS_DIR = join(directory, 'providers');
process.env.VIRAL_HIT_RECIPES_DIR = join(directory, 'recipes');
mkdirSync(process.env.VIRAL_HIT_PROVIDERS_DIR); mkdirSync(process.env.VIRAL_HIT_RECIPES_DIR);
for (const name of ['procedural-images', 'procedural-audio', 'visual-conform', 'media-inspector']) cpSync(resolve('../../examples/providers', name), join(process.env.VIRAL_HIT_PROVIDERS_DIR, name), { recursive: true });
const folder = join(process.env.VIRAL_HIT_PROVIDERS_DIR, 'author-test'); mkdirSync(folder);
writeFileSync(join(folder, 'provider.mjs'), "throw Error('Authoring must not execute this module');");
writeFileSync(join(folder, 'provider.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'author-test', label: 'Author test', scope: 'specialized', environment: ['VH_AUTHOR_TEST_SECRET'], models: [{ id: 'author-image', name: 'Frame from video', kind: 'image', aspectRatios: ['1:1'], maxReferenceImages: 2, requiresImageInput: true, controls: [
  { key: 'caption', label: 'Caption', type: 'string', maxLength: 50, default: '' },
  { key: 'steps', label: 'Steps', type: 'number', min: 1, max: 10, integer: true, default: 2 },
  { key: 'transparent', label: 'Transparent', type: 'boolean', default: false },
  { key: 'finish', label: 'Finish', type: 'select', choices: [{ value: 'flat', label: 'Flat' }, { value: 'soft', label: 'Soft' }], default: 'flat' },
] }] }));
after(() => { delete process.env.VH_AUTHOR_TEST_SECRET; rmSync(directory, { recursive: true, force: true }); });
const { listModelRecipeModels, buildModelRecipe } = await import('./model-recipe.server');
const { changeRecipeLibrary, inspectRecipe, installRecipe } = await import('./recipe-library');
const { compileRecipe } = await import('./recipes');
const { readInstalledRecipes } = await import('./recipe-storage');
const definition = (modelId: string, counts = { image: 0, video: 0, audio: 0 }) => ({ schemaVersion: 1 as const, id: 'authored-' + modelId, title: 'Independent recipe', version: '1.0.0', description: 'Reusable contribution', author: 'Independent author', license: 'MIT', category: 'creation', tags: ['specialized'], modelId, referenceCounts: counts, outputIndex: 0 });
const model = (id: string) => { const item = listModelRecipeModels().find(item => item.id === id); assert.ok(item, id); return item; };

test('catalog and build are data-only, with stable public identities and no project/database mutation', async () => {
  const catalog = listModelRecipeModels(); assert.deepEqual([...new Set(catalog.map(m => m.kind))].sort(), ['analysis', 'audio', 'image', 'video']);
  const chosen = model('author-image'); assert.equal(chosen.available, false); assert.deepEqual(chosen.references.image, { min: 1, max: 2 });
  const recipe = buildModelRecipe(definition(chosen.id, { image: 1, video: 0, audio: 0 }), chosen.digest);
  const review = await inspectRecipe(recipe); assert.equal(review.collision, 'none');
  assert.equal((await inspectRecipe(JSON.parse(JSON.stringify(recipe)))).digest, review.digest);
  assert.equal(existsSync(process.env.VIRAL_HIT_DATA_DIR!), false);
  assert.equal(JSON.stringify(recipe).includes('VH_AUTHOR_TEST_SECRET'), false);
  process.env.VH_AUTHOR_TEST_SECRET = 'private-value-one'; const ready = model(chosen.id); assert.equal(ready.available, true); assert.notEqual(ready.digest, chosen.digest);
  assert.throws(() => buildModelRecipe(definition(chosen.id), chosen.digest), /changed/);
  process.env.VH_AUTHOR_TEST_SECRET = 'private-value-two'; assert.equal(model(chosen.id).digest, ready.digest);
  assert.equal(JSON.stringify(listModelRecipeModels()).includes('private-value'), false); delete process.env.VH_AUTHOR_TEST_SECRET;
});

test('typed controls, required portable sources and fixed model survive JSON and compile with chosen project values', () => {
  const chosen = model('author-image'), recipe = buildModelRecipe(definition(chosen.id, { image: 2, video: 0, audio: 0 }), chosen.digest);
  assert.deepEqual(recipe, JSON.parse(JSON.stringify(recipe)));
  assert.equal(recipe.parameters.filter(p => p.type === 'asset').every(p => !('default' in p)), true);
  const plan = compileRecipe(recipe, { prompt: 'Draw', 'image-1': 'owned-one', 'image-2': 'owned-two', 'option-steps': 4, 'option-transparent': true }, 'project');
  const input = plan.nodes[0].input as { modelId: string; references: {assetId:string}[]; parameters: {provider_options:unknown} };
  assert.equal(input.modelId, chosen.id); assert.deepEqual(input.references.map(r => r.assetId), ['owned-one', 'owned-two']);
  assert.deepEqual(input.parameters.provider_options, { caption: '', steps: 4, transparent: true, finish: 'flat' });
  assert.throws(() => compileRecipe(recipe, { prompt: 'Draw' }, 'project'), /image-1/);
  assert.throws(() => compileRecipe(recipe, { prompt: 'Draw', 'image-1': 'one', 'image-2': 'two', 'option-steps': 1.5 }, 'project'), /option-steps/);
});

test('mixed media and analysis counts are enforced with no implicit project assets', () => {
  const chosen = model('visual-cut'), recipe = buildModelRecipe(definition(chosen.id, { image: 1, video: 1, audio: 1 }), chosen.digest);
  assert.deepEqual(recipe.parameters.filter(p => p.type === 'asset').map(p => p.id), ['image-1', 'video-1', 'audio-1']);
  assert.deepEqual(recipe, JSON.parse(JSON.stringify(recipe)), 'optional number integer property must not break review/install hashing');
  assert.throws(() => buildModelRecipe(definition(chosen.id), chosen.digest), /video/i);
  assert.throws(() => buildModelRecipe(definition(chosen.id, { image: 2, video: 1, audio: 0 }), chosen.digest));
  assert.throws(() => buildModelRecipe(definition(chosen.id, { image: 0, video: 0.5, audio: 0 }), chosen.digest));
  const analysis = model('technical-video-review');
  assert.throws(() => buildModelRecipe(definition(analysis.id), analysis.digest), /video/i);
  const audio = model('procedural-sound');
  const sound = buildModelRecipe(definition(audio.id), audio.digest);
  assert.equal((sound.nodes[0].input as {mode:string}).mode, 'audio');
  assert.equal(sound.parameters.some(p => p.id === 'aspect-ratio'), false);
  const report = buildModelRecipe(definition(analysis.id, { image: 0, video: 1, audio: 0 }), analysis.digest);
  assert.equal(report.nodes[0].operation, 'generation.model');
  assert.throws(() => buildModelRecipe({ ...definition(analysis.id, { image: 0, video: 1, audio: 0 }), outputIndex: 1 }, analysis.digest), /one report/);
  assert.throws(() => buildModelRecipe(definition('removed-model'), chosen.digest), /unavailable/);
});

test('shared service review and normal installation preserve canonical recipe identity and collision handling', async () => {
  const chosen = model('visual-frame');
  const review = await changeRecipeLibrary({ action: 'build_model', definition: definition(chosen.id, { image: 0, video: 1, audio: 0 }), expectedModelDigest: chosen.digest });
  assert.ok('collision' in review); assert.equal(review.collision, 'none');
  const exported = JSON.parse(JSON.stringify(review.recipe));
  assert.equal((await inspectRecipe(exported)).digest, review.digest);
  assert.equal((await installRecipe(exported, review.digest)).installed, true);
  assert.equal((await inspectRecipe(exported)).collision, 'same');
  assert.equal((await inspectRecipe({ ...exported, title: 'Another contributor' })).collision, 'different');
  assert.equal(readInstalledRecipes().length, 1);
  assert.equal(existsSync(join(process.env.VIRAL_HIT_DATA_DIR!, 'harness.db')), false);
});

test('CLI uses the same public catalog and writes a portable recipe without overwriting existing files', () => {
  const run = (...args:string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/recipe.ts', ...args], { encoding: 'utf8', env: process.env, timeout: 30_000 });
  const listed = run('model-catalog'); assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).models, JSON.parse(JSON.stringify(listModelRecipeModels())));
  const chosen = model('procedural-gradient'), file = join(directory, 'definition.json'), output = join(directory, 'recipe.json');
  writeFileSync(file, JSON.stringify(definition(chosen.id)));
  const built = run('build-model', file, chosen.digest, output); assert.equal(built.status, 0, built.stderr);
  const before = readFileSync(output, 'utf8'); assert.deepEqual(JSON.parse(before), JSON.parse(built.stdout).inspection.recipe);
  const duplicate = run('build-model', file, chosen.digest, output); assert.notEqual(duplicate.status, 0); assert.equal(readFileSync(output, 'utf8'), before);
});
