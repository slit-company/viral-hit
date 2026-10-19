import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importComfyRecipe, inspectComfyGraph } from './import-comfy-recipe';
import { compileRecipe } from './recipes';
import { runtimeNodeSchema } from './requests';
import { loadRecipes } from './recipe-registry';

const graph = () => ({
  '1': { class_type: 'ExampleSource', inputs: { prompt: 'literal $(touch /tmp/do-not-run)', width: 512, enabled: true, 'a/b~c': 'escaped' }, _meta: { title: 'Source' } },
  '2': { class_type: 'ExampleSource', inputs: { prompt: 'second prompt' } },
  '3': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'Imported' } },
});
const definition = () => ({ schemaVersion: 1, id: 'community-workflow', version: '1.0.0', title: 'Community workflow', description: 'User-owned graph', license: 'MIT', author: 'Example contributor', category: 'general', tags: ['comfyui'],
  output: { nodeId: '3', field: 'images', kind: 'image', index: 0 }, parameters: [
    { parameter: { id: 'prompt', label: 'Prompt', type: 'string' }, targets: [{ nodeId: '1', input: 'prompt' }, { nodeId: '2', input: 'prompt' }] },
    { parameter: { id: 'width', label: 'Width', type: 'number', integer: true, min: 64, max: 4096 }, targets: [{ nodeId: '1', input: 'width' }] },
    { parameter: { id: 'enabled', label: 'Enabled', type: 'boolean', default: false }, targets: [{ nodeId: '1', input: 'enabled' }] },
  ],
});
test('import preserves native graph and provenance; shared parameters compile into executable recipe stages', () => {
  const original = graph(), before = structuredClone(original), recipe = importComfyRecipe(original, definition());
  assert.deepEqual(original, before);
  assert.deepEqual((recipe.nodes[0].input as any).workflow, before);
  assert.equal(recipe.license, 'MIT'); assert.equal(recipe.author, 'Example contributor');
  assert.equal(recipe.parameters[0].default, before['1'].inputs.prompt);
  const plan = compileRecipe(recipe, { prompt: 'new prompt', width: 768 }, 'project');
  plan.nodes.forEach(node => runtimeNodeSchema.parse(node));
  const input = plan.nodes[0].input as any;
  assert.equal(input.workflow['1'].inputs.prompt, 'new prompt'); assert.equal(input.workflow['2'].inputs.prompt, 'new prompt');
  assert.equal(input.workflow['1'].inputs.width, 768); assert.equal(input.workflow['1'].inputs.enabled, false);
  assert.deepEqual(input.workflow['3'].inputs.images, ['1', 0]);
  assert.deepEqual(plan.nodes[1].bindings, [{ node: 'workflow', pointer: '/binaryReceipt', target: '/receipt' }]);
});
test('inspection lists installed-node requirements and separates scalar inputs from connections', () => {
  const result = inspectComfyGraph(graph());
  assert.equal(result[0].classType, 'ExampleSource'); assert.equal(result[0].title, 'Source');
  assert.equal(result[2].inputs.find(i => i.input === 'images')?.exposable, false);
  assert.equal(result[0].inputs.find(i => i.input === 'enabled')?.exposable, true);
  assert.throws(() => inspectComfyGraph({ nodes: [], links: [] }));
});
test('import rejects invalid outputs, missing fields, links, incompatible types, overlapping parameters and defaults', () => {
  const mutate = (change: (d: any) => void) => { const d = definition(); change(d); return () => importComfyRecipe(graph(), d); };
  assert.throws(mutate(d => { d.output.nodeId = 'missing'; }));
  assert.throws(mutate(d => { d.parameters[0].targets[0].input = 'absent'; }), /Missing/);
  assert.throws(mutate(d => { d.parameters[0].targets[0] = { nodeId: '3', input: 'images' }; }), /scalar/);
  assert.throws(mutate(d => { d.parameters[0].parameter.type = 'number'; }), /scalar/);
  assert.throws(mutate(d => { d.parameters[1].parameter.default = -1; }), /Invalid recipe parameter/);
  assert.throws(mutate(d => { d.parameters.push({ ...d.parameters[0], parameter: { ...d.parameters[0].parameter, id: 'second' } }); }), /overlap/);
  assert.throws(mutate(d => { d.parameters.push(d.parameters[0]); }), /Duplicate/);
  assert.throws(mutate(d => { d.script = 'any code'; }));
});
test('escaped inputs and enum choices stay data; unsafe property bindings fail', () => {
  const d: any = definition(); d.parameters = [{ parameter: { id: 'choice', label: 'Choice', type: 'enum', options: ['escaped', 'other'] }, targets: [{ nodeId: '1', input: 'a/b~c' }] }];
  const plan = compileRecipe(importComfyRecipe(graph(), d), { choice: 'other' }, 'p');
  assert.equal((plan.nodes[0].input as any).workflow['1'].inputs['a/b~c'], 'other');
  d.parameters[0].targets[0].input = 'constructor';
  assert.throws(() => importComfyRecipe(graph(), d), /Unsafe/);
});
test('imported recipe obeys registry size limits before publication', () => {
  const g: any = graph(); g['1'].inputs.unexposed = 'x'.repeat(128_000);
  assert.throws(() => importComfyRecipe(g, definition()), /128 KB/);
});
test('CLI installs a discoverable recipe offline, refuses overwrite, and leaves no file after invalid input', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-comfy-import-'));
  try {
    const input = join(dir, 'graph.json'), spec = join(dir, 'definition.json'), outputDir = join(dir, 'recipes');
    const { mkdirSync } = await import('node:fs'); mkdirSync(outputDir);
    const output = join(outputDir, 'community.json');
    writeFileSync(input, JSON.stringify(graph())); writeFileSync(spec, JSON.stringify(definition()));
    const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/recipe.ts', ...args], { encoding: 'utf8', timeout: 15000, env: { ...process.env, VIRAL_HIT_COMFYUI_URL: '', COMFY_API_KEY: '' } });
    const imported = run('import-comfy', input, spec, output); assert.equal(imported.status, 0, imported.stderr);
    assert.equal((await loadRecipes(outputDir))[0].id, 'community-workflow');
    const before = readFileSync(output, 'utf8');
    assert.notEqual(run('import-comfy', input, spec, output).status, 0); assert.equal(readFileSync(output, 'utf8'), before);
    writeFileSync(input, JSON.stringify({ nodes: [], links: [] }));
    const invalid = join(outputDir, 'invalid.json');
    assert.notEqual(run('import-comfy', input, spec, invalid).status, 0); assert.equal(existsSync(invalid), false);
    assert.notEqual(run('import-comfy', spec, spec, input).status, 0);
    assert.deepEqual(JSON.parse(readFileSync(input, 'utf8')), { nodes: [], links: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
