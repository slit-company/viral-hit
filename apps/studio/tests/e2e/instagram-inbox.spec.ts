import { test, expect } from '@playwright/test';
const headers = { 'x-viral-hit-workspace-request': '1' };

test('Instagram DM collection saves its project, queues a check and reports the state at desktop and phone sizes', async ({ page, request }) => {
  await page.route('https://www.facebook.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Meta consent fixture</h1>' }));
  await page.goto('/connections'); await page.getByRole('button', { name: 'Connect Instagram', exact: true }).click();
  await expect(page).toHaveURL(/^https:\/\/www.facebook.com\//);
  const state = new URL(page.url()).searchParams.get('state')!;
  await page.goto(`http://127.0.0.1:3042/api/app/publishing/instagram/callback?state=${state}&code=fixture-code`);
  await page.getByLabel('Page and Instagram account', { exact: true }).selectOption('112');
  await page.getByRole('button', { name: 'Connect this account', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3042/connections');
  const created = await request.post('/api/app/projects', { headers, data: { name: 'Field Notes · DM references' } }); expect(created.ok()).toBe(true);
  const { id } = await created.json();
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload();
  const panel = page.getByRole('article', { name: 'Instagram account field_notes', exact: true }).first().getByRole('region', { name: 'DM video collection', exact: true });
  await expect(panel.getByRole('button', { name: 'Check now', exact: true })).toBeDisabled();
  await panel.getByRole('combobox', { name: 'Save to project', exact: true }).selectOption(id);
  await expect(panel.getByRole('checkbox', { name: 'Check every 15 minutes', exact: true })).toBeChecked();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  const inboxes = async () => (await (await request.get('/api/app/publishing/instagram/inbox', { headers })).json()).inboxes as { accountId: string; settings: { projectId: string; enabled: boolean; revision: number } | null; check: { requestedAt: number | null; nextCheckAt: number | null } }[];
  const saved = (await inboxes()).find(item => item.settings?.projectId === id)!;
  expect(saved.settings).toMatchObject({ projectId: id, enabled: true, revision: 1 });
  // Turning collection on schedules the first check right away instead of after a full interval.
  expect(saved.check.nextCheckAt).toBeLessThanOrEqual(Date.now());
  await panel.getByRole('button', { name: 'Check now', exact: true }).click();
  await expect(panel.getByRole('status')).toHaveText('A check will start within a minute.');
  await expect(panel.getByRole('button', { name: 'Check now', exact: true })).toBeDisabled();
  expect((await inboxes()).find(item => item.accountId === saved.accountId)?.check.requestedAt).toBeTruthy();
  await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/instagram-inbox-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/instagram-inbox-mobile.png' });
  // A stale revision cannot overwrite the saved settings.
  expect((await request.post('/api/app/publishing/instagram/inbox', { headers, data: { action: 'configure', accountId: saved.accountId, projectId: id, enabled: false, expectedRevision: 0 } })).status()).toBe(409);
  const off = await request.post('/api/app/publishing/instagram/inbox', { headers, data: { action: 'configure', accountId: saved.accountId, projectId: id, enabled: false, expectedRevision: 1 } });
  expect(off.ok()).toBe(true); expect((await off.json()).settings.enabled).toBe(false);
  expect((await request.get('/api/app/publishing/instagram/inbox')).status()).toBe(403);
});
