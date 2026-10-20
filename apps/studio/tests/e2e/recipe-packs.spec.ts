import { test, expect, type APIRequestContext } from '@playwright/test';

const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_recipe_pack', arguments: args } },
  });
  expect(response.ok()).toBe(true); const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.error).toBeUndefined(); expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent.result;
}

test('general and job-specific packs are reviewed, installed together and grouped in Runs', async ({ page, request }) => {
  const created = await request.post('/api/app/projects', { headers, data: { name: 'Pack gallery QA' } });
  const id = (await created.json()).id;
  await page.goto('/editor/' + id);
  await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
  await page.getByRole('button', { name: 'Recipe library', exact: true }).click();
  const packs = page.getByRole('region', { name: 'Recipe packs' });
  await expect(packs.getByText('Short-form reel kit', { exact: true })).toBeVisible();
  await expect(packs.getByText('Editing basics', { exact: true })).toBeVisible();
  await expect(packs.getByText('General', { exact: true })).toHaveCount(1);
  await expect(packs.getByText('For a specific job', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Review Short-form reel kit', exact: true }).click();
  const review = page.getByRole('region', { name: 'Pack review' });
  await expect(review.getByText('Reel: hook, cut and call to action', { exact: true })).toBeVisible();
  await expect(review.getByText('Installing adds them to this library; no jobs start.', { exact: false })).toBeVisible();
  await review.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/packs-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await review.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/packs-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await review.getByRole('button', { name: 'Install pack', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Short-form reel kit is ready: 3 recipes' })).toBeVisible();
  const picker = page.getByRole('combobox', { name: 'Creative recipe' });
  await expect(picker).toHaveValue('short-form-reel-hook-cut');
  const groups = await picker.locator('optgroup').evaluateAll(nodes => nodes.map(node => [node.getAttribute('label'), node.querySelectorAll('option').length]));
  expect(groups).toContainEqual(['Short-form reel kit · For a specific job', 3]);
  await expect(page.getByLabel('Hook', { exact: true })).toHaveValue('WAIT FOR THE LAST ONE');
  await expect(page.getByLabel('Narration length (seconds)', { exact: true })).toBeVisible();
  const runs = await (await request.get('/api/app/projects/' + id + '/runs')).json();
  expect(runs.runs).toHaveLength(0);
  const listed = await mcp(request, { request: { action: 'list' } });
  const reel = listed.available.find((item: { summary: { id: string } }) => item.summary.id === 'short-form-reel');
  expect(reel.state).toBe('installed');
  const replay = await mcp(request, { request: { action: 'install', pack: reel.manifest, expectedDigest: reel.summary.digest } });
  expect(replay.installed).toBe(false);
  const changed = structuredClone(reel.manifest); changed.version = '1.0.1';
  const conflict = await request.post('/api/app/recipe-packs', { headers, data: { action: 'inspect', pack: changed } });
  expect((await conflict.json()).blocking[0]).toContain('new pack ID');
  const untrusted = await request.post('/api/app/recipe-packs', { data: { action: 'list' } });
  expect(untrusted.status()).toBe(403);
  await request.delete('/api/app/projects', { headers, data: { projectIds: [id] } });
});

