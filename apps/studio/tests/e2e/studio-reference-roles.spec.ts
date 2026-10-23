import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const headers = { 'x-viral-hit-workspace-request': '1' }, evidence = '../../research/evidence/reference-roles';
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
async function choose(page: Page, name: string) { await page.getByRole('button', { name: 'Model', exact: true }).click(); await page.getByRole('option', { name, exact: true }).click(); }
const pixel = (path: string, x: number, y: number) => [...execFileSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', 'crop=4:4:' + x + ':' + y + ',scale=1:1', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])];

test('Studio assigns subject and style roles that reach the model and come back from history', async ({ page, request }) => {
  await mkdir(evidence, { recursive: true });
  for (const color of ['red', 'blue']) execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=' + color + ':s=64x64', '-frames:v', '1', evidence + '/' + color + '.png']);
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Reference roles studio' } })).json()).id;
  const submitted: Array<{ references: Array<{ role: string }> }> = [];
  page.on('request', req => { if (req.url().endsWith('/api/effects/generate')) submitted.push(req.postDataJSON().generation); });
  await page.goto('/studio/' + projectId + '?target=image&model=subject-on-style');
  await choose(page, 'Subject on style');
  await page.locator('[data-vh-composer] textarea').fill('Red subject on a blue style');
  await page.getByLabel('Visual reference files', { exact: true }).setInputFiles([evidence + '/red.png', evidence + '/blue.png']);
  await expect(page.getByRole('button', { name: 'Visual sources', exact: true })).toHaveText('Sources · 2');
  await page.getByRole('button', { name: 'Visual sources', exact: true }).click();
  await page.getByLabel('Role of red.png', { exact: true }).selectOption('subject');
  await page.getByLabel('Role of blue.png', { exact: true }).selectOption('style');
  await page.screenshot({ path: evidence + '/roles-dialog.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/app/projects/' + projectId + '/generations')).json()).items[0]?.status).toBe('succeeded');
  expect(submitted[0].references.map(reference => reference.role)).toEqual(['subject', 'style']);
  const [item] = (await (await request.get('/api/app/projects/' + projectId + '/generations')).json()).items;
  await writeFile(evidence + '/output.png', await (await request.get(item.resultUrl)).body());
  const center = pixel(evidence + '/output.png', 254, 254), edge = pixel(evidence + '/output.png', 8, 8);
  expect(center[0] > 240 && center[2] < 20, String(center)).toBe(true);
  expect(edge[2] > 200 && edge[0] < 40, String(edge)).toBe(true);

  await page.evaluate(id => sessionStorage.removeItem('viral-hit:studio-visual-sources:' + id), projectId);
  await page.reload();
  await choose(page, 'Subject on style');
  await page.locator('article').first().getByRole('button').first().click();
  await page.getByRole('button', { name: 'Visual sources', exact: true }).click();
  await expect(page.getByLabel('Role of red.png', { exact: true })).toHaveValue('subject');
  await expect(page.getByLabel('Role of blue.png', { exact: true })).toHaveValue('style');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: evidence + '/roles-dialog-mobile.png', animations: 'disabled' });
});

