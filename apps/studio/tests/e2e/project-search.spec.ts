import { test, expect } from '@playwright/test';

const headers = { 'x-viral-hit-workspace-request': '1' };

test('projects can be searched by name, sorted, paged past the recent list and deleted from results', async ({ page, request }) => {
  for (let index = 1; index <= 26; index++) await request.post('/api/app/projects', { headers, data: { name: 'Paged project ' + String(index).padStart(2, '0') } });
  for (const name of ['Apple search target', 'Zebra search target', '100% literal_match', '100 percent decoy']) await request.post('/api/app/projects', { headers, data: { name } });
  // Agents use the same search through MCP.
  const rpc = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_project_list', arguments: { query: 'search target', sort: 'name' } } } });
  const body = await rpc.text();
  const listed = JSON.parse(JSON.parse(body.startsWith('{') ? body : body.split('\n').find(line => line.startsWith('data: '))!.slice(6)).result.content[0].text);
  expect(listed.map((project: { name: string }) => project.name)).toEqual(['Apple search target', 'Zebra search target']);
  await page.goto('/projects');
  const search = page.getByRole('searchbox', { name: 'Search projects', exact: true });
  const cards = page.locator('main article h2');

  await search.fill('search target');
  await expect(cards).toHaveText(['Zebra search target', 'Apple search target']);
  await page.getByLabel('Sort projects', { exact: true }).selectOption('name');
  await expect(cards).toHaveText(['Apple search target', 'Zebra search target']);

  await search.fill('100%');
  await expect(cards).toHaveText(['100% literal_match']);
  await search.fill('xyz-no-such-project');
  await expect(page.getByRole('status')).toHaveText('No projects match this search.');

  await search.fill('Paged project');
  await expect(cards).toHaveCount(24);
  await page.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(cards).toHaveCount(26);
  await expect(cards.first()).toHaveText('Paged project 01');

  await search.fill('Zebra search');
  await expect(cards).toHaveText(['Zebra search target']);
  await page.locator('main article').first().getByRole('button', { name: 'Delete project' }).click();
  await page.getByRole('button', { name: 'Delete project', exact: true }).last().click();
  await expect(page.getByRole('status')).toHaveText('No projects match this search.');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

