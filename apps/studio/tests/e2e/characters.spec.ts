import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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
  const download = page.waitForEvent('download');
  await page.getByRole('dialog', { name: 'Mina Fox' }).getByRole('link', { name: 'Download character file', exact: true }).click();
  const file = resolve('test-results/mina-fox.viralhit-character.tar');
  await (await download).saveAs(file);
  expect(execFileSync('tar', ['-tf', file], { encoding: 'utf8' }).split('\n').filter(Boolean)).toHaveLength(4);
  await page.getByRole('dialog', { name: 'Mina Fox' }).getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('dialog', { name: 'Mina Fox' }).getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Mina Fox', exact: true })).toHaveCount(0);
  expect(await read()).toBeUndefined();

  // The file brings the character back, here or in another installation, with every image and rule.
  expect((await request.post('/api/app/characters/import', { headers: { 'content-type': 'application/x-tar' }, data: readFileSync(file) })).status()).toBe(403);
  await page.getByLabel('Import character', { exact: true }).setInputFiles(file);
  const restored = page.getByRole('dialog', { name: 'Mina Fox' });
  await expect.poll(() => loadedImages(restored.getByRole('region', { name: 'Saved reference images' }))).toBe(3);
  const back = await read();
  expect([back.id, back.invariants, back.references.map((item: { sha256: string; role: string }) => item.sha256 + ':' + item.role)]).toEqual(['mina-fox-2', saved.invariants, saved.references.map((item: { sha256: string; role: string }) => item.sha256 + ':' + item.role)]);
  await restored.getByRole('button', { name: 'Archive', exact: true }).click();
  await restored.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Mina Fox', exact: true })).toHaveCount(0);
  // Keep seeded fixtures within the recent-project list used by later specs.
  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } })).ok()).toBe(true);
});

async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
  expect(response.ok()).toBe(true);
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent?.result;
}

test('choosing a character in the Canvas composer attaches its main image and writes its brief once', async ({ page, request }) => {
  const front = png('nori-front.png', '0xdb2777');
  const created = await request.post('/api/app/characters', { headers, multipart: {
    request: JSON.stringify({ action: 'create', profile: { name: 'Nori', kind: 'illustrated', description: 'Pink cat illustration', invariants: ['star-shaped ear tag'], forbidden: [], providerIdentities: [] } }),
    roles: JSON.stringify(['canonical']), file: { name: 'nori-front.png', mimeType: 'image/png', buffer: readFileSync(front.path) } } });
  expect(created.ok(), await created.text()).toBe(true);
  const character = await created.json();
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Nori canvas' } })).json()).id;
  await mcp(request, 'viral_hit_canvas_apply', { projectId, operations: [{ type: 'upsert_card', card: { id: 'nori-draft', kind: 'generation', type: 'image', name: 'Nori shot', prompt: 'Nori waves at the camera.', modelId: 'subject-on-style' }, frame: { x: 420, y: 160, w: 360, h: 300 } }] });
  const snapshot = async () => (await (await request.get('/api/app/projects/' + projectId + '/snapshot')).json()).document as { cards: { id: string; kind: string; assetId?: string; referenceCardIds?: string[] }[] };

  await page.goto('/canvas/' + projectId);
  const node = page.locator('.react-flow__node').first();
  await expect(node).toBeVisible();
  await page.waitForTimeout(800);
  await node.dblclick();
  const prompt = page.locator('textarea').first();
  await expect(prompt).toHaveValue('Nori waves at the camera.');
  const brief = 'Nori (illustrated): Pink cat illustration. Keep exactly: star-shaped ear tag.';
  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: 'Upload image', exact: true }).last().click();
    const choose = page.getByRole('button', { name: 'Use Nori: attach the main image and add the brief', exact: true });
    await expect(choose).toBeVisible();
    if (round === 0) await page.screenshot({ path: 'test-results/characters-canvas-menu.png' });
    await choose.click();
    await expect.poll(async () => { const cards = (await snapshot()).cards; const image = cards.filter(card => card.kind === 'asset' && card.assetId?.startsWith('chr-'));
      return [image.length, cards.find(card => card.id === 'nori-draft')?.referenceCardIds?.filter(id => id === image[0]?.id).length]; }).toEqual([1, 1]);
    await expect.poll(async () => (await prompt.inputValue()).split(brief).length - 1).toBe(1);
  }
  expect(await prompt.inputValue()).toContain('Nori waves at the camera.');
  await page.screenshot({ path: 'test-results/characters-canvas-desktop.png' });

  // Agents reach the same state by following the bundled skill with the character and Canvas tools.
  const skill = await mcp(request, 'viral_hit_skill_get', { skillId: 'consistent-characters' }) as { manifest?: { id: string }; compatible?: boolean; skill?: { manifest: { id: string }; compatible: boolean } };
  expect([skill.manifest?.id ?? skill.skill?.manifest.id, skill.compatible ?? skill.skill?.compatible]).toEqual(['consistent-characters', true]);
  const used = await mcp(request, 'viral_hit_character', { request: { action: 'use', id: character.id, projectId } }) as { brief: string; assets: { assetId: string; role: string; publicUrl: string }[] };
  const main = used.assets.find(asset => asset.role === 'canonical')!;
  expect(used.brief).toBe(brief);
  await mcp(request, 'viral_hit_canvas_apply', { projectId, operations: [
    { type: 'upsert_card', card: { id: 'nori-agent-ref', kind: 'asset', type: 'image', name: 'Nori', assetId: main.assetId, url: main.publicUrl } },
    { type: 'upsert_card', card: { id: 'nori-agent', kind: 'generation', type: 'image', name: 'Nori agent shot', prompt: 'Nori jumps. ' + used.brief, modelId: 'gpt-image-2.5-flare', referenceCardIds: ['nori-agent-ref'] } },
    { type: 'place_card', cardId: 'nori-agent', sourceCardIds: ['nori-agent-ref'] },
  ] });
  await expect.poll(async () => (await snapshot()).cards.find(card => card.id === 'nori-agent')?.referenceCardIds).toEqual(['nori-agent-ref']);

  expect((await request.post('/api/app/characters', { headers, data: { action: 'archive', id: character.id, expectedVersion: character.version } })).ok()).toBe(true);
  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId] } })).ok()).toBe(true);
});
