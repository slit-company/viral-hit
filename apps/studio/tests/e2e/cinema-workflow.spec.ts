import { test, expect, type APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function call(request: APIRequestContext, projectId: string, payload: unknown) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_shot', arguments: { projectId, request: payload } } },
  });
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent.result;
}

test('Cinema plans through UI and MCP, produces real local takes and appends one to the editable timeline', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Cinema direction fixture' } })).json()).id;
  const url = '/api/app/projects/' + projectId + '/shots';
  expect((await request.post(url, { data: { action: 'preview', spec: { subject: 'A cyclist' } } })).status()).toBe(403);
  await page.goto('/cinema/' + projectId);
  await expect(page.getByLabel('Workspace name', { exact: true })).toHaveValue('Cinema direction fixture');
  await page.getByRole('textbox', { name: 'Subject', exact: true }).fill('A cyclist in an amber jacket');
  await page.getByRole('textbox', { name: 'Action', exact: true }).fill('rides past a lake');
  await page.getByRole('combobox', { name: 'Service', exact: true }).selectOption('cinema-fixture');
  await page.getByRole('combobox', { name: 'Length', exact: true }).selectOption('3');
  await expect(page.getByRole('button', { name: 'Render takes (2)', exact: true })).toBeEnabled();
  const draft = await page.evaluate(id => JSON.parse(localStorage.getItem('viral-hit:cinema:' + id)!), projectId);
  const preview = await (await request.post(url, { headers, data: { action: 'preview', spec: draft } })).json();
  expect(await call(request, projectId, { action: 'preview', spec: draft })).toEqual(preview);
  expect(preview.production.still.modelId).toBe('cinema-keyframe-fixture');
  expect(preview.production.video.parameters.provider_options.reference_mode).toBe('frames');
  expect((await (await request.get(url)).json()).shots).toHaveLength(0);
  const env = JSON.parse(await readFile(join(tmpdir(), 'viral-hit-e2e-worker.json'), 'utf8'));
  const worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/harness-worker.ts'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  try {
    await page.getByRole('button', { name: 'Render takes (2)', exact: true }).click();
    await expect.poll(async () => (await (await request.get(url)).json()).shots[0]?.takes.filter((take: { state: string }) => take.state === 'succeeded').length, { timeout: 45_000 }).toBe(2);
    const shots = (await (await request.get(url)).json()).shots;
    expect(shots[0].still.state).toBe('succeeded');
    await expect(page.locator('video').first()).toBeVisible();
    await page.getByRole('button', { name: 'Add to timeline', exact: true }).first().click();
    await expect.poll(async () => {
      const timeline = await (await request.get('/api/app/projects/' + projectId + '/timeline')).json();
      return timeline.timeline?.document.tracks.flatMap((track: { clips: unknown[] }) => track.clips).length ?? 0;
    }).toBe(1);
    const first = shots[0].still.assetId, last = shots[0].takes[0].assetId;
    expect(first).toBeTruthy(); expect(last).toBeTruthy();
    // Reusing the keyframe plans takes only, so a variant does not pay for a second keyframe.
    await page.getByRole('button', { name: 'Reuse keyframe', exact: true }).click();
    await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('viral-hit:cinema:' + id)!).startAssetId, projectId)).toBe(first);
    const reused = await (await request.post(url, { headers, data: { action: 'preview', spec: { ...draft, startAssetId: first } } })).json();
    expect(reused.production.still).toBeNull();
    expect(reused.production.video.parameters.provider_options.reference_mode).toBe('frames');
    await expect(page.getByRole('button', { name: 'Render takes (2)', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Choose an end frame', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('img').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(draft.subject);
    expect((await call(request, projectId, { action: 'list' })).shots).toHaveLength(1);
    await page.screenshot({ path: 'test-results/cinema-workflow-desktop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    const exit = new Promise(resolve => worker.once('exit', resolve)); worker.kill('SIGTERM'); await exit;
  }
});

test('Korean Cinema retains direction, model choices and optional end frame without overflow', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: '시네마 한국어 확인' } })).json()).id;
  await page.context().addCookies([{ name: 'PARAGLIDE_LOCALE', value: 'ko', url: 'http://127.0.0.1:3042' }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ko/cinema/' + projectId);
  await expect(page.getByRole('heading', { name: '샷 연출하기', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '피사체', exact: true }).fill('호숫가를 달리는 자전거');
  const straight = page.getByRole('button', { name: /바로 영상으로/ });
  await expect(straight).toHaveCount(1);
  await straight.click();
  await expect(page.getByRole('button', { name: '끝 프레임 선택', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/cinema-workflow-korean-mobile.png', animations: 'disabled' });
});
