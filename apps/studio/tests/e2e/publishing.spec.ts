import { test, expect } from '@playwright/test';

const headers = { 'x-viral-hit-workspace-request': '1' };
test('publishing connections expose retained channel state and revision-checked local disconnect at desktop and mobile sizes', async ({ page, request }) => {
  expect((await request.get('/api/app/publishing/accounts')).status()).toBe(403);
  const response = await request.get('/api/app/publishing/accounts', { headers }); expect(response.ok()).toBe(true);
  const before = await response.json(); expect(before.youtube).toBe('ready'); expect(before.accounts).toHaveLength(1);
  expect(JSON.stringify(before)).not.toMatch(/e2e-token|e2e-refresh|credential|verifier/);
  await page.goto('/connections');
  await expect(page.getByRole('heading', { name: 'Connect your channels' })).toBeVisible();
  const card = page.getByRole('article', { name: 'Channel Open Studio · Stories, experiments and creative projects' });
  await expect(card.getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect YouTube', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/publishing-connections-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await card.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Confirm disconnect' })).toBeVisible();
  await expect(page.getByText('Uploaded videos and remote schedules stay on YouTube.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/publishing-disconnect-mobile.png' });
  await card.getByRole('button', { name: 'Confirm disconnect' }).click();
  await expect(card.getByText('Disconnected', { exact: true })).toBeVisible();
  const stored = await (await request.get('/api/app/publishing/accounts', { headers })).json();
  expect(stored.accounts[0].revision).toBe(before.accounts[0].revision + 1);
  const stale = await request.post('/api/app/publishing/accounts', { headers, data: { action: 'disconnect', accountId: before.accounts[0].id, revision: before.accounts[0].revision } });
  expect(stale.status()).toBe(409);
  await page.reload(); await expect(card.getByText('Disconnected', { exact: true })).toBeVisible();
});

test('browser consent uses private per-flow cookie and handles cross-site return without leaking callback parameters', async ({ page, context }) => {
  // Intercept the consent document only. Real account HTTP routes, cookie handling and denied callback run unchanged.
  await page.route('https://accounts.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Consent navigation fixture</h1>' }));
  await page.goto('/connections');
  await page.getByRole('button', { name: 'Connect YouTube', exact: true }).click();
  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  const target = new URL(page.url()), state = target.searchParams.get('state')!;
  expect(target.searchParams.get('code_challenge_method')).toBe('S256');
  const cookies = (await context.cookies('http://127.0.0.1:3042/api/app/publishing/youtube/callback')).filter(cookie => cookie.name.startsWith('vh-publishing-'));
  expect(cookies).toHaveLength(1); expect(cookies[0].httpOnly).toBe(true); expect(cookies[0].sameSite).toBe('Lax');
  await page.goto(`http://127.0.0.1:3042/api/app/publishing/youtube/callback?state=${state}&iss=https://accounts.google.com&error=access_denied&error_description=private-description&returnTo=https://invalid.example`);
  await expect(page).toHaveURL('http://127.0.0.1:3042/connections?youtube=denied');
  await expect(page.getByRole('status').filter({ hasText: 'Google access was declined.' })).toHaveText('Google access was declined. You can connect again when ready.');
  await expect(page.getByRole('button', { name: 'Connect YouTube', exact: true })).toBeEnabled();
  expect((await context.cookies()).some(cookie => cookie.name.startsWith('vh-publishing-'))).toBe(false);
  expect(await page.locator('body').innerText()).not.toMatch(/private-description|invalid\.example/);
});

test('mobile editor retains reachable project and connection controls without overlap', async ({ page, request }) => {
  const response = await request.post('/api/app/projects', { headers, data: { name: 'Connection navigation QA' } });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/editor/${id}`);
  const back = page.getByRole('button', { name: 'Back home', exact: true }), runs = page.getByRole('button', { name: 'Generation runs', exact: true });
  await expect(back).toBeVisible(); await expect(runs).toBeVisible();
  const backBox = await back.boundingBox(), runsBox = await runs.boundingBox();
  expect(backBox!.x + backBox!.width).toBeLessThanOrEqual(runsBox!.x);
  const nav = await page.getByRole('navigation', { name: 'Workspace view' }).boundingBox();
  expect(nav!.y).toBeGreaterThanOrEqual(backBox!.y + backBox!.height);
  await runs.click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/publishing-editor-mobile.png' });
  await page.getByRole('link', { name: 'Publishing connections', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect your channels' })).toBeVisible();
  await page.getByRole('button', { name: 'Back home', exact: true }).click();
  await expect(page).toHaveURL(/\/(projects)?$/);
});
