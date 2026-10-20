import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TimelineDocument } from '../../src/core/editor/timeline-document';
const headers = { 'x-viral-hit-workspace-request': '1' };
async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', { headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
  expect(response.ok()).toBe(true); const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.error).toBeUndefined(); expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent.result;
}
test('portable file downloads, imports, reopens, edits and renders through shared UI/MCP services', async ({ page, request }) => {
  test.setTimeout(180_000);
  const response = await request.post('/api/app/projects', { headers, data: { name: 'Make It Yours · Portable motion' } });
  const id = (await response.json()).id;
  const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
  const upload = async (name: string, color: string, size: string) => {
    const buffer = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=${size}`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
    const result = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name, mimeType: 'image/png', buffer } } });
    expect(result.ok()).toBe(true); return (await result.json()).asset;
  };
  const background = await upload('Ink.png', '0x111827', '640x360'), mark = await upload('Lime.png', '0xb8f945', '128x128');
  const motion = { version: 1, keyframes: [
    { id: 'a', time: 0, x: .2, y: .5, width: .15, opacity: .4, rotation: -25, easing: 'ease-in-out' },
    { id: 'b', time: 2, x: .8, y: .5, width: .3, opacity: 1, rotation: 35, easing: 'linear' },
  ] };
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [
    { type: 'add_clip', clipId: 'base', assetId: background.id, sourceType: 'image', sourceDuration: 2, name: 'Ink stage' },
    { type: 'add_overlay', clipId: 'mark', assetId: mark.id, name: 'Lime motion', startTime: 0, duration: 2, width: .15 },
    { type: 'set_overlay_motion', clipId: 'mark', motion },
  ] });
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Project file', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare project file', exact: true }).click();
  const downloadLink = page.getByRole('link', { name: 'Download project file', exact: true });
  await expect(downloadLink).toBeVisible();
  await page.screenshot({ path: 'test-results/bundle-desktop.png' });
  const download = page.waitForEvent('download'); await downloadLink.click();
  const path = resolve('test-results/portable.viralhit.tar'); await (await download).saveAs(path);
  expect(execFileSync('tar', ['-tf', path], { encoding: 'utf8' })).toContain('manifest.json');
  const trusted = await request.post('/api/app/project-bundles', { data: { projectId: id } }); expect(trusted.status()).toBe(403);
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles(path);
  await expect(page.getByLabel('Verified project contents')).toContainText('2 media · 0 cards · 2 clips');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Create new project', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/bundle-mobile.png' });
  await page.getByRole('button', { name: 'Create new project', exact: true }).click();
  const importedLink = page.getByRole('link', { name: 'Open imported project', exact: true });
  await expect(importedLink).toBeVisible();
  const importedId = (await importedLink.getAttribute('href'))!.split('/').pop()!;
  expect(importedId).not.toBe(id);
  await importedLink.click(); await expect(page).toHaveURL(new RegExp(`/editor/${importedId}$`));
  const read = async (projectId: string) => (await (await request.get(`/api/app/projects/${projectId}/timeline`)).json()).timeline.document as TimelineDocument;
  const imported = await read(importedId), original = await read(id);
  expect(imported.tracks.flatMap(t => t.clips).find(c => c.id === 'mark')!.motion).toEqual(motion);
  expect(imported.tracks.flatMap(t => t.clips).find(c => c.id === 'mark')!.assetId).not.toBe(mark.id);
  const renders: string[] = [];
  for (const projectId of [id, importedId]) {
    const result = await mcp(request, 'viral_hit_editor_render', { projectId });
    const file = `test-results/bundle-${projectId}.mp4`;
    await writeFile(file, await (await request.get(result.asset.publicUrl)).body()); renders.push(file);
  }
  for (const time of [.1, .8, 1.7]) {
    const frames = renders.map(file => execFileSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'scale=160:90', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']));
    expect(frames[0].equals(frames[1]), `equal rendered pixels at ${time}s`).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'Lime motion 2.00s', exact: true }).click();
  await page.getByRole('button', { name: 'Remove animation', exact: true }).click();
  await expect.poll(async () => (await read(importedId)).tracks.flatMap(t => t.clips).find(c => c.id === 'mark')!.motion).toBeUndefined();
  expect((await read(id)).tracks).toEqual(original.tracks);
  const mcpReview = await mcp(request, 'viral_hit_project_file_inspect', { path });
  const accepted = await request.post(`/api/app/project-bundles/${mcpReview.id}/accept`, { headers, data: { sha256: mcpReview.sha256 } }); expect(accepted.ok()).toBe(true);
  const replay = await mcp(request, 'viral_hit_project_file_accept', { reviewId: mcpReview.id, sha256: mcpReview.sha256 }); expect(replay.replayed).toBe(true);
  // Keep seeded fixtures within the recent-project list used by later specs.
  const created = [id, importedId, (await accepted.json()).projectId];
  await page.getByRole('button', { name: 'Project file', exact: true }).click();
  await page.getByLabel('Choose project file', { exact: true }).setInputFiles({ name: 'broken.viralhit.tar', mimeType: 'application/x-tar', buffer: Buffer.from('broken') });
  await expect(page.getByRole('alert')).toBeVisible();
  const removed = await request.delete('/api/app/projects', { headers, data: { projectIds: created } }); expect(removed.ok()).toBe(true);
});
