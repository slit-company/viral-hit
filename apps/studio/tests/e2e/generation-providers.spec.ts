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


test('a local video goes through the installed inspector in Canvas without a cloud upload', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Actual local video inspection' } })).json()).id;
  const source = resolve('test-results/local-analysis-source.mp4');
  execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=c=orange:s=180x320:r=12:d=1','-c:v','libx264','-pix_fmt','yuv420p',source]);
  const uploaded = await request.post(`/api/app/projects/${projectId}/assets`, { headers, multipart: { file: { name: 'source.mp4', mimeType: 'video/mp4', buffer: readFileSync(source) } } });
  expect(uploaded.ok()).toBe(true);
  const asset = (await uploaded.json()).asset;
  await mcp(request, 'viral_hit_canvas_apply', { projectId, operations: [
    { type: 'upsert_card', card: { id: 'local-source', kind: 'asset', type: 'video', name: 'Local original', url: asset.publicUrl, assetId: asset.id } },
    { type: 'place_card', cardId: 'local-source' },
    { type: 'upsert_card', card: { id: 'local-review', kind: 'generation', type: 'video', generationMode: 'analysis', modelId: 'vertical-delivery-review', name: 'Inspect file', prompt: 'Check dimensions and audio', referenceCardIds: ['local-source'] } },
    { type: 'place_card', cardId: 'local-review' },
  ] });
  const uploads: string[] = [];
  page.on('request', req => { if(req.url().includes('/api/storage/upload')) uploads.push(req.url()); });
  await page.goto('/canvas/' + projectId);
  const draft = page.locator('.react-flow__node[data-id="local-review"]');
  await expect(draft).toBeVisible();
  await expect(async () => {
    if (!(await page.locator('textarea').first().isVisible())) await draft.dblclick();
    await expect(page.locator('textarea').first()).toHaveValue('Check dimensions and audio', {timeout:1000});
  }).toPass({timeout:10000});
  await expect(page.getByRole('button', {name:'Analysis model',exact:true})).toContainText('Vertical delivery review');
  await page.getByRole('button',{name:'Model options',exact:true}).click();
  await page.getByLabel('Report name',{exact:true}).fill('Delivery');
  await page.getByLabel('Report name',{exact:true}).press('End');
  await page.getByLabel('Report name',{exact:true}).pressSequentially(' audit');
  await expect(page.getByLabel('Report name',{exact:true})).toHaveValue('Delivery audit');
  await page.getByLabel('Minimum height',{exact:true}).fill('720');
  await page.getByLabel('Expected framing',{exact:true}).selectOption('landscape');
  await page.getByLabel('Show source checksum',{exact:true}).selectOption('false');
  await page.screenshot({animations:'disabled',path:'test-results/provider-options-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'Apply options',exact:true})).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({animations:'disabled',path:'test-results/provider-options-mobile.png'});
  await page.getByRole('button',{name:'Apply options',exact:true}).click();
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('button',{name:'Model options',exact:true}).click();
  await expect(page.getByLabel('Minimum height',{exact:true})).toHaveValue('720');
  await page.getByLabel('Minimum height',{exact:true}).press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Analysis model',exact:true}).click();
  await page.getByRole('button',{name:'Technical video review',exact:true}).click();
  await page.getByRole('button',{name:'Model options',exact:true}).click();
  await expect(page.getByLabel('Minimum height',{exact:true})).toHaveValue('0');
  await page.getByLabel('Minimum height',{exact:true}).press('Escape');
  await page.getByRole('button',{name:'Analysis model',exact:true}).click();
  await page.getByRole('button',{name:'Vertical delivery review',exact:true}).click();
  await page.getByRole('button',{name:'Model options',exact:true}).click();
  await expect(page.getByLabel('Minimum height',{exact:true})).toHaveValue('720');
  await page.getByLabel('Minimum height',{exact:true}).press('Escape');
  const customSubmission = page.waitForRequest(req => req.url().endsWith('/api/effects/generate'));
  await page.getByRole('button', {name:'Analyze',exact:true}).click();
  expect((await customSubmission).postDataJSON().generation.parameters.provider_options).toEqual({report_name:'Delivery audit',minimum_height:720,framing:'landscape',include_hash:false});
  await expect(page.getByText('Delivery audit — measured file metadata', {exact:false}).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('180 × 320', {exact:false}).first()).toBeVisible();
  await page.locator('.react-flow__node[data-id="local-review"]').dblclick();
  await page.getByRole('button',{name:'Model options',exact:true}).click();
  await expect(page.getByLabel('Minimum height',{exact:true})).toHaveValue('720');
  await expect(page.getByLabel('Show source checksum',{exact:true})).toHaveValue('false');
  await page.getByLabel('Minimum height',{exact:true}).fill('9000');
  await page.getByRole('button',{name:'Apply options',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Invalid model option');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Model options',exact:true}).click();
  await expect(page.getByLabel('Minimum height',{exact:true})).toHaveValue('720');
  await page.getByLabel('Minimum height',{exact:true}).press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link',{name:'Studio',exact:true}).click();
  await expect(page).toHaveURL('/studio/' + projectId);
  await expect(page.getByText('Framing: approximately 9:16.', {exact:false}).first()).toBeVisible();
  expect(uploads).toEqual([]);
  const history = (await (await request.get(`/api/app/projects/${projectId}/generations`)).json()).items;
  expect(history[0].resultText).toContain('Height target: 720px; measured 320px — below target');
  expect(history[0].resultText).toContain('Expected framing: landscape — differs');
  expect(history[0].resultText).not.toContain('Source SHA-256');
  expect(history[0].referenceVideos).toEqual([asset.publicUrl]);
  const original = await request.get(history[0].referenceVideos[0]);
  expect(original.ok()).toBe(true); expect(await original.body()).toEqual(readFileSync(source));
  await page.screenshot({animations:'disabled',path:'test-results/local-analysis-report.png'});
  await page.getByRole('link', {name:'Storyboards',exact:true}).click();
  await expect(page).toHaveURL('/storyboards/' + projectId);
  await page.getByText('Start from a model report',{exact:true}).click();
  const reports = await mcp(request,'viral_hit_storyboard',{projectId,request:{action:'analysis-sources'}}) as {sources:{generationId:string}[]};
  expect(reports.sources).toHaveLength(1);
  await page.getByLabel('Model analysis report',{exact:true}).selectOption(reports.sources[0].generationId);
  await page.getByLabel('Analysis plan title',{exact:true}).fill('A measured reference study');
  await page.getByLabel('Analysis plan use case',{exact:true}).selectOption('specialized');
  await page.getByLabel('Analysis plan intent',{exact:true}).fill('Review the vertical composition, then author the intended shot.');
  const form = page.locator('details').filter({has:page.getByText('Start from a model report',{exact:true})});
  await form.evaluate(element => element.scrollIntoView({block:'start'}));
  await page.screenshot({animations:'disabled',path:'test-results/analysis-plan-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await form.evaluate(element => element.scrollIntoView({block:'start'}));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByText('Model: media-inspector / vertical-delivery-review',{exact:true})).toBeVisible();
  await page.screenshot({animations:'disabled',path:'test-results/analysis-plan-mobile.png'});
  await page.getByRole('button',{name:'Prepare analysis draft',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({animations:'disabled',path:'test-results/analysis-plan-mobile-action.png'});
  await page.getByRole('button',{name:'Prepare analysis draft',exact:true}).click();
  await expect(page.getByLabel('Observation 1',{exact:true})).toHaveValue(/180 × 320/);
  await expect(page.getByLabel('Add reference media',{exact:true}).locator(`option[value="${asset.id}"]`)).toHaveCount(1);
  await expect(page.getByText('0 accepted in saved plan',{exact:false})).toBeVisible();
  expect(await mcp(request,'viral_hit_storyboard',{projectId,request:{action:'list'}})).toEqual([]);
  await page.getByRole('button',{name:'Save plan',exact:true}).click();
  await expect(page.getByText('Saved revision 1.',{exact:true})).toBeVisible();
  const boards = await mcp(request,'viral_hit_storyboard',{projectId,request:{action:'list'}}) as {id:string}[];
  const board = await mcp(request,'viral_hit_storyboard',{projectId,request:{action:'read',id:boards[0].id}}) as {plan:{references:{evidence:{kind:string}}[]},accepted:unknown,actions:unknown[]};
  expect(board.plan.references[0].evidence.kind).toBe('provider-analysis'); expect(board.accepted).toEqual({}); expect(board.actions).toEqual([]);
  await page.reload();
  await page.getByRole('button',{name:'Plan & references',exact:true}).click();
  await expect(page.getByLabel('Storyboard title',{exact:true})).toHaveValue('A measured reference study');
  await page.getByRole('button',{name:'Shots & results',exact:true}).click();
  await page.getByLabel('Shot direction',{exact:true}).fill('Hold the original vertical framing.');
  await page.getByRole('button',{name:'Save plan',exact:true}).click();
  await expect(page.getByText('Saved revision 2.',{exact:true})).toBeVisible();

  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } })).ok()).toBe(true);
});
