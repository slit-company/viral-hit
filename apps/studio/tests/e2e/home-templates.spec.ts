import { test, expect } from '@playwright/test';

const evidence = '../../research/evidence/higgsfield-ui';

test('home templates come from the recipe catalog and open a new project with that recipe in Runs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible();
  const templates = page.locator('section[aria-labelledby="home-templates"]');
  const cards = templates.locator('a[href^="/studio?recipe="]');
  await expect(cards).toHaveCount(9);
  const total = (await (await page.request.get('/api/app/recipes')).json()).recipes.length;
  await templates.getByRole('button', { name: 'Show all ' + total, exact: true }).click();
  await expect(cards).toHaveCount(total);
  await page.getByRole('group', { name: 'Filter templates' }).getByRole('button', { name: 'Audio', exact: true }).click();
  await expect(cards.first()).toBeVisible();
  for (const label of await cards.locator('h3 + span').allTextContents()) expect(label).toBe('Audio');
  await page.getByRole('group', { name: 'Filter templates' }).getByRole('button', { name: 'All', exact: true }).click();
  await templates.getByRole('button', { name: 'Show all ' + total, exact: true }).click();
  await page.screenshot({ path: evidence + '/e2e-home.png', fullPage: true });

  // Installed packs may add a template with the same title, so pick the bundled one by its recipe.
  await templates.locator('a[href="/studio?recipe=open-frame"]').click();
  await expect(page).toHaveURL(/\/studio\?recipe=open-frame/);
  await page.getByRole('button', { name: 'Studio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Project runs', exact: true })).toBeVisible();
  await expect(page.locator('#run-recipe')).toHaveValue('open-frame');
  expect(new URL(page.url()).searchParams.has('recipe')).toBe(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Project runs', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an uninstalled template link explains itself and the composer carries the chosen media', async ({ page }) => {
  const project = await (await page.request.post('/api/app/projects', { headers: { 'x-viral-hit-workspace-request': '1' }, data: { name: 'Missing recipe link' } })).json();
  await page.goto('/studio/' + project.id + '?recipe=not-installed-anywhere');
  await expect(page.getByRole('heading', { name: 'Project runs', exact: true })).toBeVisible();
  await expect(page.getByText('Recipe not-installed-anywhere is not installed in this workspace.', { exact: false })).toBeVisible();

  await page.goto('/');
  await page.locator('form label').filter({ hasText: 'Video' }).click();
  await expect(page.getByRole('radio', { name: 'Video', exact: true })).toBeChecked();
  await page.getByRole('textbox', { name: /Describe the image or video/ }).fill('A night train in the rain');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/studio\?/);
  const created = new URL(page.url()).searchParams;
  expect([created.get('target'), created.get('prompt')]).toEqual(['video', 'A night train in the rain']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: evidence + '/e2e-home-mobile.png', fullPage: true });
});

