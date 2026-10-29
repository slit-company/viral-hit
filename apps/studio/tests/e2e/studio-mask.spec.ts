import { selectStudioModel } from './studio-tools';
import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const headers = { 'x-viral-hit-workspace-request': '1' }, evidence = '../../research/evidence/studio-mask';
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const choose = selectStudioModel;
const pixel = (path: string, x: number, y: number) => [...execFileSync(ffmpeg, ['-v', 'error', '-i', path, '-vf', `crop=4:4:${x}:${y},scale=1:1`, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])];

test('painting a mask in Studio changes only the marked area and survives reload and history reuse', async ({ page, request }) => {
  await mkdir(evidence, { recursive: true });
  const source = evidence + '/source.png';
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=100x100[l];color=blue:s=100x100[r];[l][r]hstack', '-frames:v', '1', source]);
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Masked edit studio' } })).json()).id;
  const errors: string[] = [], submitted: Array<{ references: Array<{ assetId: string; role: string }> }> = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (req.url().endsWith('/api/effects/generate')) submitted.push(req.postDataJSON().generation); });

  await page.goto(`/studio/${projectId}?target=image&model=masked-image-edit`);
  await choose(page, 'Edit marked area');
  await page.locator('[data-vh-composer] textarea').fill('Fill the marked corner');
  await expect(page.getByRole('button', { name: 'Mark area to change', exact: true })).toBeDisabled();
  await page.getByLabel('Visual reference files', { exact: true }).setInputFiles(source);
  await expect(page.getByRole('button', { name: 'Visual sources', exact: true })).toHaveText('Sources · 1');
  await expect(page.getByRole('button', { name: '만들기', exact: true })).toBeDisabled();

  await page.getByLabel('Change in marked area', { exact: true }).selectOption('fill');

  await page.getByRole('button', { name: 'Mark area to change', exact: true }).click();
  const surface = page.getByLabel('Mask drawing area', { exact: true });
  await expect.poll(() => surface.evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(200);
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width * .1, box.y + box.height * .2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .35, box.y + box.height * .2, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: evidence + '/mask-dialog-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Use this mask', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit marked area', exact: true })).toHaveText('Area marked');

  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`/api/app/projects/${projectId}/generations`)).json()).items[0]?.status).toBe('succeeded');
  expect(submitted[0].references.map(reference => reference.role)).toEqual(['source', 'mask']);
  const [item] = (await (await request.get(`/api/app/projects/${projectId}/generations`)).json()).items;
  expect(item.referenceMask).toBeTruthy();
  const output = evidence + '/output.png';
  await writeFile(output, await (await request.get(item.resultUrl)).body());
  const marked = pixel(output, 40, 18), keptRed = pixel(output, 40, 85), keptBlue = pixel(output, 160, 50);
  expect(marked.every(value => value > 240), String(marked)).toBe(true);
  expect(keptRed[0] > 240 && keptRed[1] < 15 && keptRed[2] < 15, String(keptRed)).toBe(true);
  expect(keptBlue[2] > 240 && keptBlue[0] < 15, String(keptBlue)).toBe(true);

  await page.reload();
  await choose(page, 'Edit marked area');
  await expect(page.getByRole('button', { name: 'Edit marked area', exact: true })).toHaveText('Area marked');
  await page.evaluate(id => sessionStorage.removeItem(`viral-hit:studio-visual-sources:${id}`), projectId);
  await page.reload();
  await choose(page, 'Edit marked area');
  await expect(page.getByRole('button', { name: 'Mark area to change', exact: true })).toBeDisabled();
  await page.locator('article').first().getByRole('button').first().click();
  await expect(page.getByRole('button', { name: 'Edit marked area', exact: true })).toHaveText('Area marked');
  await page.getByRole('button', { name: 'Edit marked area', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Use this mask', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: evidence + '/mask-dialog-mobile.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});
