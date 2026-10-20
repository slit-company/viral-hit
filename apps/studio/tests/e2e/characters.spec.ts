import { test, expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
function png(name: string, color: string) {
  const buffer = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=' + color + ':s=320x400', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
  const path = resolve('test-results', name); writeFileSync(path, buffer);
  return { path, sha256: createHash('sha256').update(buffer).digest('hex') };
}
const loadedImages = (scope: Locator) => scope.locator('img').evaluateAll(images => images.filter(image => (image as HTMLImageElement).naturalWidth > 0).length);
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** The list request runs from a mount effect, so its response means the page is interactive. */
async function open(page: Page, path: string) {
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/characters');
  await page.goto(path); await loaded;
}

test('a character keeps its images and rules from the library into a project', async ({ page, request }) => {
  const front = png('mina-front.png', '0xf97316'), side = png('mina-side.png', '0x2563eb'), smile = png('mina-smile.png', '0x16a34a');
  const read = async () => (await (await request.get('/api/app/characters')).json()).characters.find((item: { name: string }) => item.name === 'Mina Fox');

  await open(page, '/characters');
  await page.getByRole('button', { name: 'New character', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New character' });
  await expect(form.getByRole('button', { name: 'Create character', exact: true })).toBeDisabled();
  await form.getByLabel('Name', { exact: true }).fill('Mina Fox');
  await form.getByLabel('Type', { exact: true }).selectOption('mascot');
  await form.getByLabel('Who or what it is', { exact: true }).fill('Orange fox mascot with a calm smile');
  await form.getByLabel('Always keep', { exact: true }).fill('white chest patch\nround glasses');
  await form.getByLabel('Never change', { exact: true }).fill('extra fingers');
  await form.getByLabel('Choose images', { exact: true }).setInputFiles([front.path, side.path]);
  await expect(form.getByLabel('Role for mina-front.png')).toHaveValue('canonical');
  await expect(form.getByLabel('Role for mina-side.png')).toHaveValue('angle');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(form.getByRole('button', { name: 'Create character', exact: true })).toBeInViewport();
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: 'test-results/characters-new-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await form.getByRole('button', { name: 'Create character', exact: true }).click();

  const detail = page.getByRole('dialog', { name: 'Mina Fox' });
  await expect(detail.getByRole('img', { name: 'Main image of Mina Fox' })).toBeVisible();
  await expect(detail.getByLabel('Prompt brief')).toContainText('white chest patch');
  await detail.getByRole('button', { name: 'Make main', exact: true }).click();
  await expect.poll(async () => (await read()).references.find((item: { role: string }) => item.role === 'canonical').sha256).toBe(side.sha256);
  await detail.getByLabel('Always keep', { exact: true }).fill('white chest patch\nround glasses\nlime scarf');
  await detail.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(async () => (await read()).invariants).toEqual(['white chest patch', 'round glasses', 'lime scarf']);
  await detail.getByLabel('Choose images', { exact: true }).setInputFiles(smile.path);
  await detail.getByRole('button', { name: 'Add 1 image', exact: true }).click();
  await expect(detail.getByRole('img', { name: /of Mina Fox$/ })).toHaveCount(3);
  await expect.poll(() => loadedImages(detail.getByRole('region', { name: 'Saved reference images' }))).toBe(3);
  await page.screenshot({ path: 'test-results/characters-detail-desktop.png' });
  const saved = await read();
  expect(saved.version).toBe(4);
  expect(saved.kind).toBe('mascot');
  expect(saved.references.map((item: { sha256: string; role: string }) => item.sha256 + ':' + item.role)).toEqual([front.sha256 + ':angle', side.sha256 + ':canonical', smile.sha256 + ':angle']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open Mina Fox', exact: true })).toContainText('3 images · 3 rules');
  await expect.poll(() => loadedImages(page.getByRole('button', { name: 'Open Mina Fox', exact: true }))).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: 'test-results/characters-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: 'test-results/characters-desktop.png' });

  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Mina Fox shots' } })).json()).id;
  await open(page, '/assets/' + projectId);
  const section = page.getByRole('region', { name: 'Characters in this project' });
  for (let round = 0; round < 2; round++) {
    await section.getByRole('button', { name: 'Add Mina Fox to this project', exact: true }).click();
    await expect(section.getByRole('status')).toContainText('3 reference images');
  }
  await expect(section.getByRole('status')).toContainText('calm smile. Keep exactly: white chest patch; round glasses; lime scarf. Never: extra fingers.');
  await expect(page.getByRole('img', { name: /^Mina-Fox-/ })).toHaveCount(3);
  const assets = (await (await request.get('/api/app/projects/' + projectId + '/assets')).json()).assets as { id: string; publicUrl: string }[];
  const copied = await Promise.all(assets.filter(asset => asset.id.startsWith('chr-')).map(async asset => createHash('sha256').update(await (await request.get(asset.publicUrl)).body()).digest('hex')));
  expect(copied.sort()).toEqual([front.sha256, side.sha256, smile.sha256].sort());
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: 'test-results/characters-project-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 960 });

  await open(page, '/characters');
  await page.getByRole('button', { name: 'Open Mina Fox', exact: true }).click();
  await page.getByRole('dialog', { name: 'Mina Fox' }).getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('dialog', { name: 'Mina Fox' }).getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Mina Fox', exact: true })).toHaveCount(0);
  expect(await read()).toBeUndefined();
  // Keep seeded fixtures within the recent-project list used by later specs.
  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } })).ok()).toBe(true);
});
