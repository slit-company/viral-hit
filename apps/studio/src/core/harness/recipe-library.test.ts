import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { inspectRecipe, installRecipe, validateRecipeManifest, changeRecipeLibrary, recipeLibraryRequest } from './recipe-library';
import { loadRecipes } from './recipe-registry';
import { prepareRecipePlan } from './recipe-plan';
import { readInstalledRecipes } from './recipe-storage';

const source = JSON.parse(readFileSync('../../recipes/local-canvas.json', 'utf8'));
async function isolated(run: (dir: string, catalog: string, data: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'vh-recipe-library-')), catalog = join(root, 'catalog'), data = join(root, 'data');
  mkdirSync(catalog); writeFileSync(join(catalog, 'original.json'), JSON.stringify(source));
  const previous = { data: process.env.VIRAL_HIT_DATA_DIR, catalog: process.env.VIRAL_HIT_RECIPES_DIR };
  process.env.VIRAL_HIT_DATA_DIR = data; process.env.VIRAL_HIT_RECIPES_DIR = catalog;
  try { await run(root, catalog, data); }
  finally {
    if (previous.data === undefined) delete process.env.VIRAL_HIT_DATA_DIR; else process.env.VIRAL_HIT_DATA_DIR = previous.data;
    if (previous.catalog === undefined) delete process.env.VIRAL_HIT_RECIPES_DIR; else process.env.VIRAL_HIT_RECIPES_DIR = previous.catalog;
    rmSync(root, { recursive: true, force: true });
  }
}

test('inspect is offline; installed recipes survive reopen and compile through the normal catalog', async () => isolated(async (_root, catalog, data) => {
  const manifest = { ...source, id: 'my-own-canvas', title: 'Independent canvas', author: 'Community author', license: 'MIT' };
  const report = await inspectRecipe(manifest);
  assert.equal(report.collision, 'none'); assert.equal(report.unavailableOperations.length, 0);
  assert.equal(existsSync(data), false);
  const before = readFileSync(join(catalog, 'original.json'));
  const result = await installRecipe(manifest, report.digest); assert.equal(result.installed, true);
  assert.deepEqual(readFileSync(join(catalog, 'original.json')), before);
  assert.deepEqual((await loadRecipes()).map(r => r.id), [source.id, manifest.id]);
  assert.deepEqual((await loadRecipes(catalog)).map(r => r.id), [source.id]);
  const compiled = await prepareRecipePlan(manifest.id, {}, 'project');
  assert.ok(compiled.nodes.some(n => n.operation === 'comfy.workflow'));
  assert.equal(readInstalledRecipes()[0].author, 'Community author');
  assert.equal(readInstalledRecipes()[0].license, 'MIT');
  assert.equal(existsSync(join(data, 'harness.db')), false);
  const reordered = Object.fromEntries(Object.entries(manifest).reverse());
  const replay = await installRecipe(reordered, report.digest);
  assert.equal(replay.installed, false); assert.equal(readInstalledRecipes().length, 1);
  assert.equal((await inspectRecipe(reordered)).collision, 'same');
}));

test('installation refuses stale reviews, changed IDs, and file-catalog overwrites', async () => isolated(async () => {
  const reserved = await inspectRecipe(source); assert.equal(reserved.collision, 'reserved');
  await assert.rejects(installRecipe(source, reserved.digest), /file catalog/);
  const manifest = { ...source, id: 'immutable-copy' }, report = await inspectRecipe(manifest);
  await assert.rejects(installRecipe({ ...manifest, title: 'Changed after review' }, report.digest), /changed after inspection/);
  await installRecipe(manifest, report.digest);
  const changed = { ...manifest, version: '2.0.0' }, changedReport = await inspectRecipe(changed);
  assert.equal(changedReport.collision, 'different');
  await assert.rejects(installRecipe(changed, changedReport.digest), /different contents/);
  assert.equal(readInstalledRecipes()[0].version, manifest.version);
}));

test('invalid defaults, graph cycles, prototype pointers and oversized payloads cannot enter the library', async () => isolated(async (_root, _catalog, data) => {
  const cyclic = structuredClone(source); cyclic.nodes[0].dependsOn = [cyclic.nodes[0].id];
  const pointer = structuredClone(source); pointer.nodes[0].parameters = [{ parameter: pointer.parameters[0].id, target: '/__proto__/x' }];
  const range = structuredClone(source); range.parameters[0] = { id: 'number', label: 'Impossible range', type: 'number', min: 8, max: 2 };
  for (const value of [cyclic, pointer, range, { ...source, id: '../escape' }, { ...source, extra: 'unexpected' }, { ...source, description: 'x'.repeat(129_000) }]) {
    assert.throws(() => validateRecipeManifest(value));
    await assert.rejects(inspectRecipe(value));
  }
  assert.equal(existsSync(data), false);
}));

test('portable recipes may require future adapters, but cannot bypass execution policy', async () => isolated(async () => {
  const manifest = { ...source, id: 'future-adapter', parameters: [], nodes: [{ id: 'step', operation: 'community.example', version: '1', input: { prompt: 'Literal text, not executable instructions' } }] };
  const report = await inspectRecipe(manifest); assert.deepEqual(report.unavailableOperations, ['community.example']);
  await installRecipe(manifest, report.digest);
  await assert.rejects(prepareRecipePlan(manifest.id, {}, 'project'), /unavailable/);
}));

test('two independent processes installing a conflicting ID cannot replace the winner', async () => isolated(async (root) => {
  const a = { ...source, id: 'concurrent-copy', title: 'Copy A' }, b = { ...a, title: 'Copy B' };
  const ar = await inspectRecipe(a), br = await inspectRecipe(b);
  const script = `import { installRecipe } from ${JSON.stringify(new URL('./recipe-library.ts', import.meta.url).href)};\nconst raw=JSON.parse(process.env.RECIPE_TEST_PAYLOAD);\ntry { await installRecipe(raw.manifest,raw.digest); process.exit(0); } catch { process.exit(7); }`;
  const scriptPath = join(root, 'install.mjs'); writeFileSync(scriptPath, script);
  const run = (manifest: unknown, digest: string) => new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', scriptPath], { env: { ...process.env, RECIPE_TEST_PAYLOAD: JSON.stringify({ manifest, digest }) }, stdio: 'pipe' });
    child.on('error', reject); child.on('exit', resolve);
  });
  const codes = await Promise.all([run(a, ar.digest), run(b, br.digest)]);
  assert.deepEqual(codes.sort(), [0, 7]);
  const recipes = readInstalledRecipes(); assert.equal(recipes.length, 1); assert.ok(['Copy A', 'Copy B'].includes(recipes[0].title));
}));

test('library capacity and database symlinks are rejected without changing stored recipes', async () => isolated(async (root, _catalog, data) => {
  const manifest = { ...source, id: 'first-copy' }, report = await inspectRecipe(manifest);
  await installRecipe(manifest, report.digest);
  const db = new DatabaseSync(join(data, 'recipe-library.sqlite'));
  try {
    const insert = db.prepare('INSERT INTO recipes VALUES (?,?,?,?)');
    db.exec('BEGIN');
    for (let i = 1; i < 200; i++) { const item = { ...manifest, id: `copy-${i}` }; insert.run(item.id, JSON.stringify(item), 'fixture', 0); }
    db.exec('COMMIT');
  } finally { db.close(); }
  const extra = { ...manifest, id: 'too-many' }, extraReport = await inspectRecipe(extra);
  await assert.rejects(installRecipe(extra, extraReport.digest), /full/);
  assert.equal(readInstalledRecipes().length, 200);
  rmSync(join(data, 'recipe-library.sqlite'));
  symlinkSync(join(root, 'must-not-create.sqlite'), join(data, 'recipe-library.sqlite'));
  assert.throws(readInstalledRecipes, /regular database/);
  await assert.rejects(installRecipe(extra, extraReport.digest), /regular database/);
  assert.equal(existsSync(join(root, 'must-not-create.sqlite')), false);
}));

test('graph authoring inspection pins content and refuses canvas layouts, oversized graphs and stale conversion', async () => isolated(async (_root, _catalog, data) => {
  const graph = JSON.parse(readFileSync('../../examples/comfy-api-resize.json', 'utf8'));
  const definition = JSON.parse(readFileSync('../../examples/comfy-resize-definition.json', 'utf8'));
  const inspected = await changeRecipeLibrary(recipeLibraryRequest.parse({ action: 'inspect_graph', graph }));
  assert.ok('graphDigest' in inspected); if (!('graphDigest' in inspected)) throw new Error('Wrong inspection result');
  assert.equal(inspected.nodes.find(n => n.nodeId === '1')!.inputs.find(i => i.input === 'image')!.exposable, true);
  assert.equal(inspected.nodes.find(n => n.nodeId === '2')!.inputs.find(i => i.input === 'image')!.exposable, false);
  const changed = structuredClone(graph); changed['2'].inputs.width += 1;
  await assert.rejects(changeRecipeLibrary(recipeLibraryRequest.parse({ action: 'convert_graph', graph: changed, definition, expectedGraphDigest: inspected.graphDigest })), /changed after inspection/);
  await assert.rejects(changeRecipeLibrary({ action: 'inspect_graph', graph: { nodes: [], links: [] } }), /API-format/);
  await assert.rejects(changeRecipeLibrary({ action: 'inspect_graph', graph: { '1': { class_type: 'Huge', inputs: { value: 'x'.repeat(128_000) } } } }), /128 KB/);
  assert.equal(existsSync(data), false);
}));

test('HTTP/MCP authoring conversion preserves attribution and image graph links without installing or queueing', async () => isolated(async (_root, _catalog, data) => {
  const graph = JSON.parse(readFileSync('../../examples/comfy-api-resize.json', 'utf8'));
  const original = structuredClone(graph);
  const definition = { ...JSON.parse(readFileSync('../../examples/comfy-resize-definition.json', 'utf8')), id: 'portable-resize-builder', author: 'Original graph author', license: 'Apache-2.0' };
  const inspected = await changeRecipeLibrary({ action: 'inspect_graph', graph });
  if (!('graphDigest' in inspected)) throw new Error('Wrong inspection result');
  const request = recipeLibraryRequest.parse({ action: 'convert_graph', graph, definition, expectedGraphDigest: inspected.graphDigest });
  const converted = await changeRecipeLibrary(request);
  if (!('recipe' in converted)) throw new Error('Wrong conversion result');
  assert.deepEqual(graph, original);
  assert.equal(converted.recipe.author, definition.author); assert.equal(converted.recipe.license, definition.license);
  assert.deepEqual((converted.recipe.nodes.find(n => n.operation === 'comfy.workflow')!.input as any).workflow, original);
  assert.equal(converted.recipe.nodes[0].operation, 'comfy.upload');
  assert.equal(converted.recipe.parameters[0].type, 'asset'); assert.equal(converted.recipe.parameters[0].default, undefined);
  assert.equal(existsSync(data), false); assert.equal((await loadRecipes()).length, 1);
  const installed = await changeRecipeLibrary({ action: 'install', manifest: converted.recipe, expectedDigest: converted.digest });
  assert.ok('installed' in installed && installed.installed);
  assert.equal((await loadRecipes()).length, 2);
  assert.equal(existsSync(join(data, 'harness.db')), false);
  assert.throws(() => recipeLibraryRequest.parse({ action: 'convert_graph', graph, expectedGraphDigest: inspected.graphDigest, definition: { ...definition, license: undefined } }));
}));
