import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
test('mixed report originals remain distinct through browser planning, editable ranges and portable project import', async ({ page, request }) => {
  const projectId = (await (await request.post('/api/app/projects', { headers, data: { name: 'Multiple original report study' } })).json()).id;
  const endpoint = `/api/app/projects/${projectId}/storyboards`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const assets: { id: string; publicUrl: string; sha256: string }[] = [];
  for (const [name, mimeType, args] of [
    ['reference.png', 'image/png', ['-f', 'lavfi', '-i', 'color=c=blue:s=80x60', '-frames:v', '1']],
    ['portrait.mp4', 'video/mp4', ['-f', 'lavfi', '-i', 'color=c=orange:s=180x320:r=12:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
    ['landscape.mp4', 'video/mp4', ['-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=12:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
    ['sound.wav', 'audio/wav', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '24000', '-c:a', 'pcm_s16le']],
  ] as const) {
    const file = resolve('test-results/report-' + name);
    execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-y', ...args, file]);
    const response = await request.post(`/api/app/projects/${projectId}/assets`, { headers, multipart: { file: { name, mimeType, buffer: readFileSync(file) } } });
    expect(response.ok()).toBe(true); assets.push((await response.json()).asset);
  }
  const generation = await request.post('/api/effects/generate', { headers, data: { generation: { version: 2, projectId, mode: 'analysis', modelId: 'media-batch-review', prompt: 'Measure each original independently', references: assets.map(asset => ({ assetId: asset.id, role: 'source' })), parameters: {} } } });
  expect(generation.ok()).toBe(true); expect((await generation.json()).status).toBe('succeeded');
  const reports = await request.post(endpoint, { headers, data: { action: 'analysis-sources' } });
  const report = (await reports.json()).sources[0];
  expect(report.reportVersion).toBe(2); expect(report.media.map((item: { assetId: string }) => item.assetId)).toEqual(assets.map(asset => asset.id));
  await page.goto('/storyboards/' + projectId);
  await expect(page.getByLabel('Model analysis report', { exact: true }).locator(`option[value="${report.generationId}"]`)).toHaveCount(1);
  await page.getByText('Start from a model report', { exact: true }).click();
  await page.getByLabel('Model analysis report', { exact: true }).selectOption(report.generationId);
  const observations = page.getByRole('list', { name: 'Report observations', exact: true });
  for (const name of ['reference.png', 'portrait.mp4', 'landscape.mp4', 'sound.wav']) await expect(observations).toContainText(name);
  await expect(observations).toContainText('Still image'); await expect(observations).toContainText('audio · 0–1s');
  await page.getByLabel('Analysis plan title', { exact: true }).fill('Four originals, one editable study');
  await page.getByLabel('Analysis plan intent', { exact: true }).fill('Review the image, two independent video intervals and audio before choosing a creative direction.');
  await page.getByLabel('Analysis plan use case', { exact: true }).selectOption('specialized');
  const form = page.locator('details').filter({ has: page.getByText('Start from a model report', { exact: true }) });
  await form.evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ animations: 'disabled', path: 'test-results/multisource-report-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await form.evaluate(element => element.scrollIntoView({ block: 'start' }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ animations: 'disabled', path: 'test-results/multisource-report-mobile.png' });
  await page.getByRole('button', { name: 'Prepare analysis draft', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: 'test-results/multisource-report-mobile-action.png' });
  await page.getByRole('button', { name: 'Prepare analysis draft', exact: true }).click();
  await expect(page.getByLabel('Observation 1', { exact: true })).toHaveValue(/80 × 60/);
  await expect(page.getByLabel('Observation 2', { exact: true })).toHaveValue(/180 × 320/);
  await expect(page.getByLabel('Observation 3', { exact: true })).toHaveValue(/320 × 180/);
  await expect(page.getByLabel('Observation 4', { exact: true })).toHaveValue(/pcm_s16le/);
  await expect(page.getByLabel('Reference start 1', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Reference start 4', { exact: true })).toHaveValue('0');
  expect(await (await request.post(endpoint, { headers, data: { action: 'list' } })).json()).toEqual([]);
  await page.getByLabel('Reference start 3', { exact: true }).fill('0.2');
  await page.getByLabel('Reference end 3', { exact: true }).fill('0.8');
  await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await expect(page.getByText('Saved revision 1.', { exact: true })).toBeVisible();
  const [board] = await (await request.post(endpoint, { headers, data: { action: 'list' } })).json();
  const saved = await (await request.post(endpoint, { headers, data: { action: 'read', id: board.id } })).json();
  expect(saved.plan.references.map((item: { assetId: string }) => item.assetId)).toEqual(assets.map(asset => asset.id));
  expect(saved.plan.references.map((item: { startTime?: number; endTime?: number }) => [item.startTime, item.endTime])).toEqual([[undefined, undefined], [0, 1], [.2, .8], [0, 1]]);
  expect(saved.plan.references[2].evidence.source).toEqual({ kind: 'video', index: 1 });
  expect(saved.accepted).toEqual({}); expect(saved.actions).toEqual([]); expect(saved.plan.audio).toEqual([]);
  await page.reload();
  await page.getByRole('button', { name: 'Plan & references', exact: true }).click();
  await expect(page.getByLabel('Reference start 3', { exact: true })).toHaveValue('0.2');
  await expect(page.getByLabel('Reference end 3', { exact: true })).toHaveValue('0.8');
  await page.getByRole('link', { name: 'Open project editor', exact: true }).click();
  // The editor header renders before it hydrates; open the dialog only once the editor has loaded.
  await expect(page).toHaveURL(/\/editor\//);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Project file', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare project file', exact: true }).click();
  const link = page.getByRole('link', { name: 'Download project file', exact: true });
  await expect(link).toBeVisible();
  const download = page.waitForEvent('download'); await link.click();
  const archive = resolve('test-results/multisource-report.viralhit.tar'); await (await download).saveAs(archive);
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles(archive);
  await expect(page.getByLabel('Verified project contents')).toContainText('1 storyboards · 0 accepted shots');
  await page.getByRole('button', { name: 'Create new project', exact: true }).click();
  const imported = page.getByRole('link', { name: 'Open imported project', exact: true });
  await expect(imported).toBeVisible(); const importedId = (await imported.getAttribute('href'))!.split('/').pop()!;
  const received = await (await request.post(`/api/app/projects/${importedId}/storyboards`, { headers, data: { action: 'read', id: board.id } })).json();
  expect(received.plan.references.map((item: { evidence: unknown }) => item.evidence)).toEqual(saved.plan.references.map((item: { evidence: unknown }) => item.evidence));
  expect(received.plan.references[2].assetId).not.toBe(assets[2].id);
  expect(received.plan.references[2].startTime).toBe(.2); expect(received.plan.references[2].endTime).toBe(.8);
  expect(received.actions).toEqual([]); expect(received.accepted).toEqual({}); expect(errors).toEqual([]);
  expect((await request.delete('/api/app/projects', { headers, data: { projectIds: [projectId, importedId] } })).ok()).toBe(true);
});
