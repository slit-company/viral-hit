import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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


test('an independent analysis model is selectable, runs through Canvas and retains its text on reload', async ({ page, request }) => {
  const models = await mcp(request, 'viral_hit_generation_models', { kind: 'analysis' }) as { id: string; kind: string }[];
  expect(models.some(model => model.id === 'analysis-fixture-review' && model.kind === 'analysis')).toBe(true);
  const projectId = JSON.parse(readFileSync('../../research/evidence/browser-fixtures/projects.json', 'utf8'))['Analysis provider E2E fixture'];
  const [asset] = (await (await request.get(`/api/app/projects/${projectId}/assets`)).json()).assets;
  await mcp(request, 'viral_hit_canvas_apply', { projectId, operations: [
    { type: 'upsert_card', card: { id: 'review-source', kind: 'asset', type: 'video', name: 'Protocol source', url: asset.publicUrl, assetId: asset.id } },
    { type: 'place_card', cardId: 'review-source' },
    { type: 'upsert_card', card: { id: 'review-draft', kind: 'generation', type: 'video', generationMode: 'analysis', modelId: 'video-analysis', name: 'Review video', prompt: 'Review this reference', referenceCardIds: ['review-source'] } },
    { type: 'place_card', cardId: 'review-draft' },
  ] });
  const source = resolve('test-results/analysis-source.mp4');
  execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=c=orange:s=320x180:r=12:d=1','-c:v','libx264','-pix_fmt','yuv420p',source]);
  await page.route('https://analysis-fixture.invalid/**', route => route.fulfill({status:200,path:source,contentType:'video/mp4'}));
  await page.goto('/canvas/' + projectId);
  const draft = page.locator('.react-flow__node[data-id="review-draft"]');
  await expect(draft).toBeVisible();
  await expect(async () => {
    if (!(await page.locator('textarea').first().isVisible())) await draft.dblclick();
    await expect(page.locator('textarea').first()).toHaveValue('Review this reference', {timeout:1000});
  }).toPass({timeout:10000});
  await page.getByRole('button', { name: 'Analysis model', exact: true }).click();
  await page.getByRole('button', {name:'Independent review fixture', exact:true}).click();
  await expect(page.getByRole('button', {name:'Analysis model', exact:true})).toContainText('Independent review fixture');
  await page.getByRole('button', {name:'Analysis model',exact:true}).click();
  await expect(page.getByRole('button',{name:'Technical video review',exact:true})).toBeVisible();
  await page.screenshot({animations:'disabled',path:'test-results/analysis-model-desktop.png'});
  await page.getByRole('button', {name:'Independent review fixture',exact:true}).click();
  const submitted = page.waitForRequest(req => req.url().endsWith('/api/effects/generate'));
  await page.getByRole('button', {name:'Analyze', exact:true}).click();
  expect((await submitted).postDataJSON().generation.modelId).toBe('analysis-fixture-review');
  await expect(page.getByText('Protocol fixture: Review this reference', {exact:false}).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Protocol fixture: Review this reference', {exact:false}).first()).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button', {name:'Fit graph to view',exact:true}).click();
  await page.locator('.react-flow__node[data-id="review-draft"]').dblclick();
  await page.getByRole('button', {name:'Analysis model',exact:true}).click();
  await expect(page.getByRole('button',{name:'Independent review fixture',exact:true})).toBeVisible();
  const option = page.getByRole('button',{name:'Independent review fixture',exact:true});
  const box = await option.boundingBox();
  expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({animations:'disabled',path:'test-results/analysis-model-mobile.png'});
  await page.getByRole('link',{name:'Studio',exact:true}).click();
  await expect(page).toHaveURL('/studio/' + projectId);
  await expect(page.getByText('Protocol fixture: Review this reference',{exact:false}).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({animations:'disabled',path:'test-results/analysis-result-mobile.png'});
  const back = page.getByRole('button',{name:'Back home',exact:true});
  const backBox = await back.boundingBox();
  const boardBox = await page.getByRole('link',{name:'Storyboards',exact:true}).boundingBox();
  expect(backBox!.x + backBox!.width).toBeLessThanOrEqual(boardBox!.x);
  await page.getByRole('button',{name:'Generation runs',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  const connections = page.getByRole('link',{name:'Publishing connections',exact:true});
  await connections.scrollIntoViewIfNeeded(); await connections.click();
  await expect(page).toHaveURL('/connections'); await page.goBack();
  await expect(page).toHaveURL('/studio/' + projectId); await back.click();
  await expect(page).toHaveURL('/');
});
