import { selectStudioModel } from './studio-tools';
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
function fixtures() {
  const files: string[] = [];
  for (const [extension, args] of [
    ['png', ['-f', 'lavfi', '-i', 'color=c=blue:s=80x60', '-frames:v', '1']],
    ['mp4', ['-f', 'lavfi', '-i', 'color=c=orange:s=180x320:r=12:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
    ['wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '24000', '-c:a', 'pcm_s16le']],
  ] as const) {
    const path = resolve('test-results/studio-source.' + extension);
    execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-y', ...args, path]);
    files.push(path);
  }
  return files;
}

test('Studio selects independent mixed analysis, uploads once, retains drafts and restores complete history without re-upload', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Studio mixed analysis' } })).json()).id;
  const failures: string[] = [], uploads: string[] = [], submissions: unknown[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('request', req => {
    if (req.method() === 'POST' && req.url().endsWith(`/projects/${projectId}/assets`)) uploads.push(req.url());
    if (req.url().endsWith('/api/effects/generate')) submissions.push(req.postDataJSON().generation);
  });
  await page.goto('/studio/' + projectId + '?target=analysis');
  await selectStudioModel(page, 'media-batch-review');
  await page.getByLabel('Analysis prompt', { exact: true }).fill('Compare the original media files');
  await page.getByLabel('Analysis files', { exact: true }).setInputFiles(fixtures());
  await expect(page.getByRole('button', { name: 'Analysis sources', exact: true })).toContainText('3');
  await expect(page.getByRole('button', { name: 'Analyze', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Task model", { exact: true })).toHaveValue('media-batch-review');
  await expect(page.getByLabel('Analysis prompt', { exact: true })).toHaveValue('Compare the original media files');
  await expect(page.getByRole('button', { name: 'Analysis sources', exact: true })).toContainText('3');
  await page.getByRole('button', { name: 'Analysis sources', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Remove source/ })).toHaveCount(3);
  await page.screenshot({ animations: 'disabled', path: 'test-results/studio-analysis-sources-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
  await page.screenshot({ animations: 'disabled', path: 'test-results/studio-analysis-sources-mobile.png' });
  await page.getByRole('button', { name: /^Remove source studio-source.wav/ }).click();
  await page.getByRole('button', { name: /^Add source studio-source.wav/ }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'test-results/studio-analysis-composer-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selectStudioModel(page, 'technical-video-review');
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('image references');
  expect(submissions).toHaveLength(0);
  await selectStudioModel(page, 'media-batch-review');
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByText('Media batch review — measured file metadata', { exact: false }).first()).toBeVisible();
  expect(uploads).toHaveLength(3); expect(submissions).toHaveLength(1);
  await page.evaluate(id => sessionStorage.removeItem(`viral-hit:studio-analysis:${id}`), projectId);
  await page.reload();
  await expect(page.getByLabel("Task model", { exact: true })).toHaveValue('media-batch-review');
  await page.locator('article').first().getByRole('button').first().click();
  await expect(page.getByLabel("Task model", { exact: true })).toHaveValue('media-batch-review');
  await expect(page.getByRole('button', { name: 'Analysis sources', exact: true })).toContainText('3');
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2);
  await expect(page.locator('article')).toHaveCount(2);
  expect(uploads).toHaveLength(3);
  expect(submissions[1]).toEqual(submissions[0]);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ animations: 'disabled', path: 'test-results/studio-analysis-composer-desktop.png' });
  expect(failures).toEqual([]);
  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } })).ok()).toBe(true);
});

test('Studio preserves an unreadable stored draft until explicit replacement and resumes saving the current selection', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Studio draft recovery' } })).json()).id;
  const key = `viral-hit:studio-analysis:${projectId}`;
  const corrupt = '{"version":1,"sources":[';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/studio/' + projectId + '?target=analysis');
  await expect(page.getByLabel('Analysis prompt', { exact: true })).toBeVisible();
  await page.evaluate(({ key, corrupt }) => sessionStorage.setItem(key, corrupt), { key, corrupt });
  await page.reload();
  await expect(page.getByRole('status')).toContainText('saved draft is unreadable');
  await expect(page.getByRole('button', { name: 'Analysis sources', exact: true })).toContainText('0');
  await selectStudioModel(page, 'media-batch-review');
  await page.getByLabel('Analysis prompt', { exact: true }).fill('New draft after recovery');
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBe(corrupt);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Replace unreadable draft', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Replace unreadable draft', exact: true })).toBeInViewport();
  await page.screenshot({ animations: 'disabled', path: 'test-results/studio-analysis-recovery-mobile.png' });
  await page.getByRole('button', { name: 'Replace unreadable draft', exact: true }).click();
  await expect(page.getByText('The saved draft is unreadable and retained.', { exact: false })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Analysis prompt', { exact: true })).toHaveValue('New draft after recovery');
  await expect(page.getByLabel("Task model", { exact: true })).toHaveValue('media-batch-review');
  expect(errors).toEqual([]);
  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } })).ok()).toBe(true);
});

test('Studio rejects excess files before uploading and restores declared model settings from the actual report history', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Studio technical analysis' } })).json()).id;
  const video = fixtures()[1];
  let uploads = 0;
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith(`/projects/${projectId}/assets`)) uploads++; });
  await page.goto('/studio/' + projectId + '?target=analysis');
  await selectStudioModel(page, 'technical-video-review');
  await page.getByLabel('Analysis prompt', { exact: true }).fill('Measure this original');
  await page.getByLabel('Analysis files', { exact: true }).setInputFiles([video, video]);
  await expect(page.getByRole('alert')).toContainText('at most 1 video');
  expect(uploads).toBe(0);
  await page.getByLabel('Analysis files', { exact: true }).setInputFiles(video);
  await expect(page.getByRole('button', { name: 'Analysis sources', exact: true })).toContainText('1');
  await page.getByLabel('Report name', { exact: true }).fill('Studio original audit');
  await page.getByLabel('Minimum height', { exact: true }).fill('720');
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  await expect(page.getByText('Studio original audit — measured file metadata', { exact: false }).first()).toBeVisible();
  await page.evaluate(id => sessionStorage.removeItem(`viral-hit:studio-analysis:${id}`), projectId);
  await page.reload();
  await page.locator('article').first().getByRole('button').first().click();
  await expect(page.getByLabel("Task model", { exact: true })).toHaveValue('technical-video-review');
  await expect(page.getByLabel('Report name', { exact: true })).toHaveValue('Studio original audit');
  await expect(page.getByLabel('Minimum height', { exact: true })).toHaveValue('720');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(uploads).toBe(1);
  const item = (await (await request.get(`/api/app/projects/${projectId}/generations`)).json()).items[0];
  expect(item.modelOptions.values.minimum_height).toBe(720);
  expect(item.resultText).toContain('measured 320px — below target');
  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } })).ok()).toBe(true);
});
