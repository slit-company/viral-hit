import { test, expect } from '@playwright/test';

const headers = { 'x-viral-hit-workspace-request': '1' };

test('a review link carries comments to the owner, keeps viewers read-only and stops when revoked', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Shared review QA' } })).json()).id;
  const share = async (role: 'viewer' | 'editor') => (await (await request.post('/api/app/projects/' + projectId + '/collaboration', { headers, data: { action: 'share', role } })).json()) as { path: string };
  const viewer = await share('viewer'), editor = await share('editor');
  const command = (path: string) => request.post('/api' + path, { headers, data: { command: { type: 'editor.apply', operations: [{ type: 'upsert_caption', clipId: 'review-note', text: 'Tighten this cut', startTime: 1, duration: 1.5 } ] } } });

  // The reviewer sees the project, writes a comment and cannot edit.
  await page.goto(viewer.path);
  await expect(page.getByRole('heading', { name: 'Shared review QA' })).toBeVisible();
  await expect(page.getByText('No cut to watch yet.', { exact: false })).toBeVisible();
  await page.getByLabel('Your name').fill('Mina');
  await page.getByLabel('Write a comment').fill('Open on the face, not the street.');
  await page.getByRole('button', { name: 'Send comment' }).click();
  await expect(page.getByText('Open on the face, not the street.')).toBeVisible();
  expect((await command(viewer.path)).status()).toBe(403);

  // An editor link changes the timeline through the same command path.
  expect((await command(editor.path)).status()).toBe(200);
  const timeline = await (await request.get('/api/app/projects/' + projectId + '/timeline')).json();
  expect(JSON.stringify(timeline)).toContain('Tighten this cut');

  // The owner reads and settles the comment beside the timeline, then revokes the viewer link.
  await page.goto('/editor/' + projectId);
  await page.getByRole('button', { name: 'Comments, 1 open' }).click();
  await expect(page.getByRole('dialog').getByText('Mina')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as done' }).click();
  await expect(page.getByRole('dialog').getByText('settled by Owner')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Share project' }).click();
  await expect(page.getByRole('dialog').getByText('Active links · 2')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).last().click();
  await expect(page.getByRole('dialog').getByText('Active links · 1')).toBeVisible();
  const remaining = (await (await request.get('/api/app/projects/' + projectId + '/collaboration')).json()) as { shares: { role: string; revokedAt: number | null }[] };
  const revokedRole = remaining.shares.find(item => item.revokedAt)?.role;
  const gone = revokedRole === 'viewer' ? viewer.path : editor.path;
  expect((await request.get('/api' + gone)).status()).toBe(404);
  await page.goto(gone);
  await expect(page.getByText('This link is not active.', { exact: false })).toBeVisible();
});
