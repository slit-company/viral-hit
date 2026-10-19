import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { preflightComfyPlan } from './comfy-preflight';
import type { Plan } from './durable';
import { compileRecipe, compileRecipeForCheck } from './recipes';

const source = { input: { required: { checkpoint: [['installed.safetensors'], {}], width: ['INT', { min: 64, max: 4096 }] } }, output: ['IMAGE'] };
const save = { input: { required: { images: ['IMAGE', {}], filename_prefix: ['STRING', {}] } }, output: [], output_node: true };
const plan = (): Plan => ({ projectId: 'project', nodes: [{ id: 'workflow', operation: 'comfy.workflow', version: '1', input: { workflow: {
  '1': { class_type: 'Source', inputs: { checkpoint: 'installed.safetensors', width: 512 } },
  '2': { class_type: 'Save', inputs: { images: ['1', 0], filename_prefix: 'Output' } },
}, output: { nodeId: '2', field: 'images', index: 0 } } }] });
async function server(schemas: Record<string, unknown>, mode = 'normal') {
  const calls: { method: string; path: string }[] = [];
  const http = createServer((req, res) => {
    calls.push({ method: req.method!, path: req.url! });
    const name = decodeURIComponent(req.url!.slice('/object_info/'.length));
    if (mode === 'redirect') { res.writeHead(302, { Location: '/unexpected' }); res.end(); return; }
    if (mode === 'slow') return;
    if (mode === 'error') { res.writeHead(503); res.end(); return; }
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'large') { res.end(' '.repeat(2_000_001)); return; }
    res.end(JSON.stringify(Object.hasOwn(schemas, name) ? { [name]: schemas[name] } : {}));
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  return { calls, url: new URL(`http://127.0.0.1:${(http.address() as any).port}/`), close: () => new Promise<void>(resolve => { http.closeAllConnections(); http.close(() => resolve()); }) };
}
test('preflight reads each installed class once and never submits a job or upload', async () => {
  const s = await server({ Source: source, Save: save });
  try {
    const p = plan(); (p.nodes[0].input as any).workflow['3'] = structuredClone((p.nodes[0].input as any).workflow['1']);
    const original = structuredClone(p);
    const report = await preflightComfyPlan(p, { url: s.url });
    assert.equal(report.status, 'checked'); assert.deepEqual(report.issues, []); assert.deepEqual(p, original);
    assert.deepEqual(s.calls.map(c => c.method), ['GET', 'GET']); assert.ok(s.calls.every(c => c.path.startsWith('/object_info/')));
  } finally { await s.close(); }
});
test('missing classes and unavailable checkpoint choices are distinct, with actual choices retained', async () => {
  const s = await server({ Source: source });
  try {
    const p = plan(); (p.nodes[0].input as any).workflow['1'].inputs.checkpoint = 'missing.safetensors';
    const report = await preflightComfyPlan(p, { url: s.url });
    assert.equal(report.status, 'issues'); assert.equal(report.classes.find(c => c.name === 'Save')?.status, 'missing');
    assert.deepEqual(report.issues.find(i => i.input === 'checkpoint')?.choices, ['installed.safetensors']);
  } finally { await s.close(); }
});
test('numeric range, missing required input and dangling links are reported before execution', async () => {
  const s = await server({ Source: source, Save: save });
  try {
    const p = plan(), graph = (p.nodes[0].input as any).workflow;
    graph['1'].inputs.width = 32; graph['2'].inputs.images = ['missing-node', 0]; delete graph['2'].inputs.filename_prefix;
    const report = await preflightComfyPlan(p, { url: s.url });
    assert.equal(report.issues.filter(i => i.severity === 'issue').length, 3);
    graph['2'].inputs.images = ['1', 4];
    assert.ok((await preflightComfyPlan(p, { url: s.url })).issues.some(i => i.message.includes('output index')));
  } finally { await s.close(); }
});
test('upload-bound filenames are deferred rather than rejected against the current server file list', async () => {
  const s = await server({ Source: { input: { required: { image: [[], { image_upload: true }] } }, output: ['IMAGE'] }, Save: save });
  try {
    const p = plan(); (p.nodes[0].input as any).workflow['1'].inputs = { image: 'not-uploaded-yet.png' };
    p.nodes.unshift({ id: 'reference', operation: 'comfy.upload', version: '1', input: { assetId: 'example' } });
    p.nodes[1].dependsOn = ['reference']; p.nodes[1].bindings = [{ node: 'reference', pointer: '/image', target: '/workflow/1/inputs/image' }];
    const report = await preflightComfyPlan(p, { url: s.url });
    assert.equal(report.status, 'checked'); assert.equal(report.issues.length, 1); assert.equal(report.issues[0].severity, 'deferred');
    p.nodes[1].bindings = [];
    assert.equal((await preflightComfyPlan(p, { url: s.url })).status, 'issues');
  } finally { await s.close(); }
});
test('unconfigured, malformed, failed, redirected, oversized and timed-out schemas stay unknown', async () => {
  assert.equal((await preflightComfyPlan(plan(), { url: null })).status, 'unavailable');
  for (const mode of ['normal', 'error', 'redirect', 'large', 'slow']) {
    const s = await server({ Source: {}, Save: {} }, mode);
    try {
      const report = await preflightComfyPlan(plan(), { url: s.url, signal: AbortSignal.timeout(mode === 'slow' ? 30 : 5000) });
      assert.equal(report.status, 'unavailable', mode); assert.ok(report.classes.every(c => c.status === 'unavailable'));
      assert.ok(s.calls.every(c => c.path.startsWith('/object_info/')));
    } finally { await s.close(); }
  }
});
test('non-native recipes do not contact the configured server', async () => {
  const s = await server({});
  try {
    assert.equal((await preflightComfyPlan({ projectId: 'p', nodes: [{ id: 'local', operation: 'asset.materialize', version: '1', input: { url: 'https://example.invalid/image.png', kind: 'image' } }] }, { url: s.url })).status, 'not-applicable');
    assert.equal(s.calls.length, 0);
    const malformedClass = plan(); (malformedClass.nodes[0].input as any).workflow['1'].class_type = '..';
    await preflightComfyPlan(malformedClass, { url: s.url });
    assert.ok(s.calls.every(call => call.path.startsWith('/object_info/')));
  } finally { await s.close(); }
});
test('missing user choices can be inspected without making the recipe executable', async () => {
  const p = plan();
  const recipe = { schemaVersion: 1, id: 'inspection', version: '1.0.0', title: 'Inspection', description: 'Missing values', author: 'Test', license: 'MIT', category: 'test', parameters: [{ id: 'checkpoint', type: 'string', label: 'Checkpoint' }], nodes: [{ ...p.nodes[0], parameters: [{ parameter: 'checkpoint', target: '/workflow/1/inputs/checkpoint' }] }] };
  assert.throws(() => compileRecipe(recipe, {}, 'project'), /Invalid recipe parameter/);
  const prepared = compileRecipeForCheck(recipe, {}, 'project');
  const s = await server({ Source: source, Save: save });
  try {
    const report = await preflightComfyPlan(prepared.plan, { url: s.url, deferredInputs: prepared.deferredInputs });
    assert.equal(report.status, 'checked');
    assert.equal(report.issues[0].severity, 'deferred'); assert.deepEqual(report.issues[0].choices, ['installed.safetensors']);
    assert.throws(() => compileRecipe(recipe, {}, 'project'), /Invalid recipe parameter/);
  } finally { await s.close(); }
});
test('cleared fields are deferred during inspection while ordinary execution still rejects them', () => {
  const recipe = { schemaVersion: 1, id: 'cleared', version: '1.0.0', title: 'Cleared', description: 'Cleared input values', author: 'Test', license: 'MIT', category: 'test', parameters: [
    { id: 'text', type: 'string', label: 'Required' }, { id: 'width', type: 'number', label: 'Width', default: 512 }, { id: 'negative', type: 'string', label: 'Optional empty text', default: '', minLength: 0 },
  ], nodes: [{ id: 'node', operation: 'example', version: '1', input: { text: '', width: 512, negative: '' }, parameters: [{ parameter: 'text', target: '/text' }, { parameter: 'width', target: '/width' }, { parameter: 'negative', target: '/negative' }] }] };
  const supplied = { text: '', width: '', negative: '' };
  assert.deepEqual(compileRecipeForCheck(recipe, supplied, 'p').deferredInputs.node, ['/text', '/width']);
  assert.throws(() => compileRecipe(recipe, supplied, 'p'), /Invalid/);
});
