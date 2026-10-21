import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
  expect(response.ok()).toBe(true);
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent?.result;
}

test('a model from an installed provider is listed for agents and generates from the Canvas into project assets', async ({ page, request }) => {
  const models = await mcp(request, 'viral_hit_generation_models', { kind: 'image' }) as { id: string; providerId: string }[];
  expect(models.filter(model => model.providerId === 'procedural-images').map(model => model.id)).toEqual(['procedural-gradient', 'procedural-gradient-queued']);
  expect(models.find(model => model.id === 'nano-banana-pro')?.providerId).toBe('cloud-api');

  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Installed provider' } })).json()).id;
  const card = { id: 'gradient-draft', kind: 'generation', type: 'image', name: 'Gradient', prompt: 'A fox at dawn', modelId: 'procedural-gradient', aspectRatio: '16:9' };
  await mcp(request, 'viral_hit_canvas_apply', { projectId, operations: [{ type: 'upsert_card', card }, { type: 'place_card', cardId: 'gradient-draft' }] });
  const generations = page.waitForRequest(req => req.url().endsWith('/api/effects/generate'));
  await page.goto('/canvas/' + projectId);
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  await page.waitForTimeout(800);
  await node.dblclick();
  await expect(page.locator('textarea').first()).toHaveValue('A fox at dawn');
  await expect(page.getByRole('button', { name: /Gradient \(instant\)/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/provider-canvas-before.png' });
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  expect((await generations).postDataJSON().generation.modelId).toBe('procedural-gradient');

  const assets = async () => (await (await request.get('/api/app/projects/' + projectId + '/assets')).json()).assets as { id: string; type: string; publicUrl: string; source?: string }[];
  await expect.poll(async () => (await assets()).filter(asset => asset.type === 'image').length, { timeout: 30_000 }).toBe(1);
  const [asset] = await assets();
  const file = resolve('test-results/provider-output.png');
  writeFileSync(file, await (await request.get(asset.publicUrl)).body());
  const ffprobe = process.env.VIRAL_HIT_FFPROBE || 'ffprobe';
  expect(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim()).toBe('png,640,360');
  await expect(page.locator('.react-flow__node img').first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/provider-canvas-after.png' });
  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } })).ok()).toBe(true);
});
