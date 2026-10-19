import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileRecipe } from './recipes';
import { loadRecipes } from './recipe-registry';
import { bindOutputs, readPointer, setPointer, validateBindings } from './bindings';
import { DurableHarness, type Adapter, type Plan } from './durable';

const recipe = () => ({ schemaVersion: 1, id: 'test-film', version: '1.0.0', title: 'A film', description: 'A general recipe', license: 'Apache-2.0', author: 'Viral Hit', category: 'film', tags: [],
  parameters: [{ id: 'prompt', type: 'string', label: 'Prompt', minLength: 3 }, { id: 'seed', type: 'number', label: 'Seed', default: 42, min: 0, integer: true }],
  nodes: [{ id: 'frame', operation: 'image', version: '1', input: { prompt: '', seed: 0 }, parameters: [{ parameter: 'prompt', target: '/prompt' }, { parameter: 'seed', target: '/seed' }] }],
});
test('portable recipe compiles user values and typed defaults without provider access', () => {
  const r = recipe(); const p = compileRecipe(r, { prompt: 'A quiet forest' }, 'p', new Set(['image']));
  assert.deepEqual(p.nodes[0].input, { prompt: 'A quiet forest', seed: 42 });
  assert.equal(p.nodes[0].version, '1@test-film:1.0.0'); assert.equal(r.nodes[0].input.prompt, '');
});
test('recipe rejects undeclared values, wrong types, out-of-range and missing operations', () => {
  assert.throws(() => compileRecipe(recipe(), { prompt: 'forest', extra: true }, 'p'), /Unknown/);
  assert.throws(() => compileRecipe(recipe(), { prompt: 'forest', seed: -1 }, 'p'), /Invalid/);
  assert.throws(() => compileRecipe(recipe(), { prompt: 'forest', seed: '42' }, 'p'), /Invalid/);
  assert.throws(() => compileRecipe(recipe(), { prompt: 'x' }, 'p'), /Invalid/);
  assert.throws(() => compileRecipe(recipe(), { prompt: 'forest' }, 'p', new Set()), /unavailable/);
});
test('recipe data cannot invoke code or bind two values to the same input', () => {
  assert.throws(() => compileRecipe({ ...recipe(), script: 'process.exit()' }, { prompt: 'forest' }, 'p'));
  const r = recipe(); r.nodes[0].parameters.push({ parameter: 'seed', target: '/prompt' });
  assert.throws(() => compileRecipe(r, { prompt: 'forest' }, 'p'), /overlap/);
});
test('JSON pointers preserve arrays and escaped keys, never object prototypes', () => {
  const input = { body: { references: [null] } };
  assert.deepEqual(bindOutputs(input, { previous: { 'a/b': { '~key': ['media'] } } }, [{ node: 'previous', pointer: '/a~1b/~0key/0', target: '/body/references/0' }]), { body: { references: ['media'] } });
  assert.equal(input.body.references[0], null);
  assert.throws(() => setPointer({}, '/__proto__/polluted', true), /Unsafe/);
  assert.throws(() => readPointer([], '/length'), /Invalid/);
  assert.throws(() => readPointer({ a: [] }, '/a/00'), /Missing|Invalid/);
  assert.throws(() => validateBindings({ a: { b: null } }, ['previous'], [{ node: 'previous', pointer: '', target: '/a' }, { node: 'previous', pointer: '', target: '/a/b' }]), /overlap/);
});
test('bound provider input is durably frozen across restart before polling', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-binding-')); const file = join(dir, 'ledger.db');
  let h = new DurableHarness(file); const p: Plan = { projectId: 'p', nodes: [
    { id: 'frame', operation: 'image', version: '1', input: {} },
    { id: 'film', operation: 'video', version: '1', input: { image: null }, dependsOn: ['frame'], bindings: [{ node: 'frame', pointer: '/asset', target: '/image' }] },
  ] };
  const image: Adapter = { recovery: 'replay', async submit() { return { id: 'frame' }; }, async poll() { return { state: 'succeeded', output: { asset: 'local-frame-hash' } }; } };
  let received: unknown;
  const video: Adapter = { recovery: 'replay', async submit(input) { received = input; return { id: 'film' }; }, async poll(_id, input) { assert.deepEqual(input, { image: 'local-frame-hash' }); return { state: 'succeeded', output: { asset: 'film-hash' } }; } };
  const run = h.enqueue(p, 'a'); const adapters = { image, video };
  for (let i = 0; i < 3; i++) await h.step(run, adapters);
  assert.deepEqual(received, { image: 'local-frame-hash' }); h.close(); h = new DurableHarness(file);
  await h.step(run, adapters); assert.equal(h.jobs(run)[1].state, 'succeeded'); h.close(); rmSync(dir, { recursive: true });
});
test('missing upstream output fails before any dependent provider submission', async () => {
  const h = new DurableHarness(':memory:'); let submits = 0;
  const a: Adapter = { recovery: 'replay', async submit() { submits++; return { id: 'a' }; }, async poll() { return { state: 'succeeded', output: {} }; } };
  const run = h.enqueue({ projectId: 'p', nodes: [{ id: 'a', operation: 'f', version: '1', input: {} }, { id: 'b', operation: 'f', version: '1', input: { media: null }, dependsOn: ['a'], bindings: [{ target: '/media', node: 'a', pointer: '/missing' }] }] }, 'a');
  for (let i = 0; i < 4; i++) await h.step(run, { f: a });
  assert.equal(submits, 1); assert.equal(h.jobs(run)[1].state, 'failed'); assert.equal(h.jobs(run)[1].attempts, 0); h.close();
});
test('registry reads third-party data manifests and rejects duplicated ids', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vh-recipes-'));
  try { writeFileSync(join(dir, 'one.json'), JSON.stringify(recipe())); assert.equal((await loadRecipes(dir))[0].id, 'test-film');
    writeFileSync(join(dir, 'two.json'), JSON.stringify(recipe())); await assert.rejects(loadRecipes(dir), /Duplicate/);
  } finally { rmSync(dir, { recursive: true }); }
});
