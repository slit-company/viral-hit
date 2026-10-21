import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function install(request: APIRequestContext, filename: string) {
  const manifest = JSON.parse(await readFile('../../examples/provider-recipes/' + filename + '.json', 'utf8'));
  const inspected = await request.post('/api/app/recipes', { headers, data: { action: 'inspect', manifest } });
  expect(inspected.ok()).toBe(true); const review = await inspected.json();
  expect(review.unavailableOperations).toEqual([]);
  expect((await request.post('/api/app/recipes', { headers, data: { action: 'install', manifest, expectedDigest: review.digest } })).ok()).toBe(true);
  return manifest;
}
async function mcp(request: APIRequestContext, projectId: string, change: unknown) {
  const response = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_runs_change', arguments: { projectId, request: change } } } });
  const text = await response.text();
  return JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6)).result;
}

test('a shared installed-model recipe queues through Runs and MCP recovers the same pinned plan without generation', async ({ page, request }) => {
  const recipe = await install(request, 'image');
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Installed model recipe' } })).json()).id;
  await page.goto('/studio/' + projectId);
  await page.getByRole('button', { name: 'Generation runs' }).click();
  await page.getByLabel('Creative recipe', { exact: true }).selectOption(recipe.id);
  await page.getByLabel('Image direction', { exact: true }).fill('Independently authored amber gradient');
  await expect(page.getByText('Uses the installed models selected in this recipe. Compute and provider charges depend on those models.')).toBeVisible();
  const pending = page.waitForResponse(response => response.url().endsWith(`/projects/${projectId}/runs`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Queue generation', exact: true }).click();
  const response = await pending; expect(response.status()).toBe(202);
  const { runId } = await response.json(), admitted = response.request().postDataJSON();
  const state = await (await request.get(`/api/app/projects/${projectId}/runs`)).json();
  const run = state.runs.find((item: { id: string }) => item.id === runId);
  expect(run.jobs).toHaveLength(1); expect(run.jobs[0].state).toBe('queued');
  const input = JSON.parse(run.jobs[0].input_json);
  expect(input.modelId).toBe('procedural-gradient'); expect(input.runtime.projectId).toBe(projectId);
  expect(input.runtime.digest).toMatch(/^[a-f0-9]{64}$/); expect(input.prompt).toBe('Independently authored amber gradient');
  const recovered = await mcp(request, projectId, admitted);
  expect(recovered.isError).not.toBe(true); expect(recovered.structuredContent.result.runId).toBe(runId);
  expect((await mcp(request, projectId, { ...admitted, values: { ...admitted.values, prompt: 'Changed direction' } })).isError).toBe(true);
  expect((await (await request.get(`/api/app/projects/${projectId}/generations`)).json()).items).toHaveLength(0);
});

test('a specialized multi-model recipe keeps source bindings and rejects forged runtime pins before queueing', async ({ page, request }) => {
  const recipe = await install(request, 'calibration-card');
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Specialized model recipe' } })).json()).id;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/studio/' + projectId); await page.getByRole('button', { name: 'Generation runs' }).click();
  await page.getByLabel('Creative recipe', { exact: true }).selectOption(recipe.id);
  const pending = page.waitForResponse(response => response.url().endsWith(`/projects/${projectId}/runs`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Queue generation', exact: true }).click();
  const response = await pending; expect(response.status()).toBe(202);
  const state = await (await request.get(`/api/app/projects/${projectId}/runs`)).json();
  const run = state.runs[0]; expect(run.jobs).toHaveLength(4);
  const conform = run.jobs.find((job: { node_id: string }) => job.node_id === 'conform');
  const input = JSON.parse(conform.input_json), bindings = JSON.parse(conform.bindings_json);
  expect(input.runtime.providerId).toBe('audio-conform'); expect(input.pins[0].sha256).toBeNull();
  expect(bindings).toContainEqual({ target: '/pins/0/sha256', node: 'sound', pointer: '/sha256' });
  const forged = await request.post(`/api/app/projects/${projectId}/runs`, { headers, data: { action: 'enqueue', requestKey: 'forged', nodes: [{ id: 'forged', operation: 'generation.model', version: '1', input }] } });
  expect(forged.status()).toBe(409); expect((await forged.json()).error).toContain('already pinned');
  expect((await (await request.get(`/api/app/projects/${projectId}/runs`)).json()).runs).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('independent upstream model controls pass review and queue while fixed invalid controls are rejected',async({page,request})=>{
  const recipe=JSON.parse(await readFile('../../examples/provider-recipes/calibration-card.json','utf8'));
  recipe.id='bound-options-'+Date.now();recipe.title='Independently bound model controls';recipe.nodes=recipe.nodes.slice(0,2);
  const sound=recipe.nodes[1];sound.dependsOn=['image'];sound.input.parameters.provider_options.frequency=0;
  sound.bindings=[{node:'image',pointer:'/width',target:'/parameters/provider_options/frequency'}];
  const inspected=await(await request.post('/api/app/recipes',{headers,data:{action:'inspect',manifest:recipe}})).json();
  expect(inspected.modelRequirements.status).toBe('checked');
  expect((await request.post('/api/app/recipes',{headers,data:{action:'install',manifest:recipe,expectedDigest:inspected.digest}})).ok()).toBe(true);
  const projectId=(await(await request.post('/api/app/projects',{headers,data:{name:'Typed upstream controls'}})).json()).id;
  await page.goto('/studio/'+projectId);await page.getByRole('button',{name:'Generation runs'}).click();await page.getByLabel('Creative recipe',{exact:true}).selectOption(recipe.id);
  await page.getByRole('button',{name:'Check requirements',exact:true}).click();
  await expect(page.getByRole('status',{name:'Server check result'}).getByText('Server check: no reported issues',{exact:true})).toBeVisible();
  const pending=page.waitForResponse(r=>r.url().endsWith(`/projects/${projectId}/runs`)&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Queue generation',exact:true}).click();const response=await pending;expect(response.status()).toBe(202);
  const admitted=response.request().postDataJSON(),{runId}=await response.json();
  const replay=await mcp(request,projectId,admitted);expect(replay.isError).not.toBe(true);expect(replay.structuredContent.result.runId).toBe(runId);
  const state=await(await request.get(`/api/app/projects/${projectId}/runs`)).json(),job=state.runs[0].jobs.find((j:{node_id:string})=>j.node_id==='sound');
  expect(JSON.parse(job.input_json).parameters.provider_options.frequency).toBe(330);
  expect(JSON.parse(job.bindings_json)).toContainEqual(sound.bindings[0]);
  const bad=structuredClone(recipe.nodes);bad[1].input.parameters.provider_options.seconds=0;
  const rejected=await request.post(`/api/app/projects/${projectId}/runs`,{headers,data:{action:'enqueue',requestKey:'bad-fixed-options',nodes:bad.map(({parameters,...node}:{parameters:unknown})=>node)}});
  expect(rejected.status()).toBe(409);expect((await rejected.json()).error).toMatch(/Length|option/);
  expect((await(await request.get(`/api/app/projects/${projectId}/runs`)).json()).runs).toHaveLength(1);
  expect((await(await request.get(`/api/app/projects/${projectId}/generations`)).json()).items).toHaveLength(0);
});
