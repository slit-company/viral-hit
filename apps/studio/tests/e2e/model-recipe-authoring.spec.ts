import { test, expect, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, value: unknown) {
  const response = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_recipe_library', arguments: { request: value } } } });
  const text = await response.text(); const result = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6)).result;
  expect(result.isError, JSON.stringify(result)).not.toBe(true); return result.structuredContent.result;
}
for (const mobile of [false, true]) test(`author, review, export and install a ${mobile ? 'specialized phone' : 'general desktop'} model recipe`, async ({ page, request }) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const id = 'authored-' + (mobile ? 'video-' : 'image-') + Date.now();
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Model authoring' } })).json()).id;
  const catalog = await (await request.post('/api/app/recipes', { headers, data: { action: 'model_catalog' } })).json();
  expect(await mcp(request, { action: 'model_catalog' })).toEqual(catalog);
  expect((await request.post('/api/app/recipes', { data: { action: 'model_catalog' } })).status()).toBe(403);
  await page.goto('/studio/' + projectId); await page.getByRole('button', { name: 'Generation runs' }).click();
  await page.getByRole('button', { name: 'Recipe library', exact: true }).click();
  await page.getByRole('button', { name: /Build from an installed model/ }).click();
  await page.getByLabel('Installed model', { exact: true }).selectOption(mobile ? 'visual-cut' : 'procedural-gradient');
  await expect(page.getByText(mobile ? 'visual-cut · video · visual-conform' : 'procedural-gradient · image · procedural-images', { exact: true })).toBeVisible();
  if (mobile) { await page.getByLabel('image sources', { exact: true }).fill('1'); await page.getByLabel('audio sources', { exact: true }).fill('1'); }
  await page.getByLabel('Recipe name', { exact: true }).fill('Independent portable recipe');
  await page.getByLabel('Recipe ID', { exact: true }).fill(id);
  await page.getByLabel('Author', { exact: true }).fill('Community contributor');
  await page.getByLabel('License', { exact: true }).fill('MIT');
  await page.getByLabel('Description', { exact: true }).fill(mobile ? 'Format a video with a badge and replacement soundtrack.' : 'An adjustable image recipe.');
  await page.getByLabel('Use case', { exact: true }).selectOption(mobile ? 'specialized' : 'general');
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await expect(page.getByLabel('Recipe ID', { exact: true })).toHaveValue(id);
  await expect(page.getByRole('button', { name: 'Build recipe for review', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Build recipe for review', exact: true }).click();
  const review = page.getByRole('region', { name: 'Recipe inspection' });
  await expect(review.getByText('Independent portable recipe', { exact: true })).toBeVisible();
  await expect(review.getByText('Ready to install as a new local recipe.', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download'); await review.getByRole('button', { name: 'Download reviewed JSON' }).click();
  const manifest = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(manifest.tags).toContain(mobile ? 'specialized' : 'general');
  expect(manifest.parameters.filter((p: {type:string}) => p.type === 'asset')).toHaveLength(mobile ? 3 : 0);
  const inspected = await mcp(request, { action: 'inspect', manifest }); expect(inspected.collision).toBe('none');
  expect((await (await request.get(`/api/app/projects/${projectId}/generations`)).json()).items).toHaveLength(0);
  expect((await (await request.get(`/api/app/projects/${projectId}/runs`)).json()).runs).toHaveLength(0);
  await page.getByRole('button', { name: 'Install recipe', exact: true }).click();
  await expect(page.getByLabel('Creative recipe', { exact: true })).toHaveValue(id);
  expect((await mcp(request, { action: 'get', recipeId: id })).digest).toBe(inspected.digest);
  await page.getByLabel('Direction', { exact: true }).fill('Amber composition');
  if (mobile) {
    await expect(page.getByLabel('Video source 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Queue generation', exact: true })).toBeDisabled();
  } else {
    const response = page.waitForResponse(response => response.url().endsWith(`/projects/${projectId}/runs`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Queue generation', exact: true }).click(); expect((await response).status()).toBe(202);
    const runs = await (await request.get(`/api/app/projects/${projectId}/runs`)).json();
    expect(JSON.parse(runs.runs[0].jobs[0].input_json).modelId).toBe('procedural-gradient');
  }
});

test('unconfigured models can be authored without execution; stale contracts and empty analysis sources are rejected', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Author without credentials' } })).json()).id;
  const catalog = await mcp(request, { action: 'model_catalog' });
  const model = catalog.models.find((m: {id:string}) => m.id === 'protected-fixture-image'); expect(model.available).toBe(false);
  const definition = { schemaVersion: 1, id: 'unconfigured-author', version: '1.0.0', title: 'Portable recipe', description: 'Configure after sharing', author: 'External author', license: 'MIT', category: 'creation', tags: ['specialized'], modelId: model.id, referenceCounts: { image: 0, video: 0, audio: 0 }, outputIndex: 0 };
  expect((await mcp(request, { action: 'build_model', definition, expectedModelDigest: model.digest })).recipe.nodes[0].operation).toBe('generation.model');
  const stale = await request.post('/api/app/recipes', { headers, data: { action: 'build_model', definition, expectedModelDigest: '0'.repeat(64) } }); expect(stale.status()).toBe(409);
  await page.goto('/studio/' + projectId); await page.getByRole('button', { name: 'Generation runs' }).click();
  await page.getByRole('button', { name: 'Recipe library', exact: true }).click(); await page.getByRole('button', { name: /Build from an installed model/ }).click();
  await page.getByLabel('Installed model', { exact: true }).selectOption(model.id);
  await expect(page.getByText(/Missing configuration. You can author and share/)).toBeVisible();
  await page.getByLabel('Installed model', { exact: true }).selectOption('technical-video-review');
  await expect(page.getByLabel('video sources', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Output index (starts at 0)', { exact: true })).toHaveCount(0);
  expect((await (await request.get(`/api/app/projects/${projectId}/generations`)).json()).items).toHaveLength(0);
});
