import { test, expect } from '@playwright/test';
import { selectStudioModel } from './studio-tools';

const headers = { 'x-viral-hit-workspace-request': '1' }, evidence = '../../research/evidence/higgsfield-ui';

test('studio results form a media grid with reuse and preview on each tile', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Results grid' } })).json()).id;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/studio/' + projectId + '?target=image&model=procedural-gradient');
  await selectStudioModel(page, 'procedural-gradient');
  const prompt = page.getByLabel('Scene description', { exact: true });
  const generate = page.getByRole('button', { name: 'Create', exact: true });
  await expect(generate).toBeVisible();
  for (const [index, text] of ['Dawn gradient', 'Dusk gradient', 'Night gradient'].entries()) {
    await prompt.fill(text);
    // The precheck accepts one request per project every 500 ms.
    await page.waitForTimeout(600);
    await generate.click();
    await expect.poll(async () => (await (await request.get('/api/app/projects/' + projectId + '/generations')).json()).items.filter((item: { status: string }) => item.status === 'succeeded').length).toBe(index + 1);
  }
  const tiles = page.locator('article');
  await expect(tiles).toHaveCount(3);
  await expect(tiles.locator('img')).toHaveCount(3);
  const tops = await tiles.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await page.screenshot({ path: evidence + '/results-grid-desktop.png' });

  await prompt.fill('');
  await tiles.first().hover();
  await tiles.first().getByRole('button').first().click();
  await expect(prompt).toHaveValue('Dawn gradient');
  await tiles.nth(1).getByRole('button', { name: 'Open preview', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Dusk gradient', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const phoneTops = await tiles.evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)));
  expect(phoneTops[0]).toBe(phoneTops[1]);
  await page.screenshot({ path: evidence + '/results-grid-mobile.png' });
  expect(errors).toEqual([]);
});

