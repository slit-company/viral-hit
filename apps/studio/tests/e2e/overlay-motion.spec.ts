import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { overlayTransformAt } from '../../src/core/editor/overlay-motion';
import type { TimelineClip, TimelineDocument } from '../../src/core/editor/timeline-document';

const headers = { 'x-viral-hit-workspace-request': '1' };
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(response.ok()).toBe(true); const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.error).toBeUndefined(); expect(rpc.result?.isError).not.toBe(true);
  return rpc.result;
}

test('UI keyframes persist, MCP shares motion, and both real MP4 exports match animated poses', async ({ page, request }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const project = await request.post('/api/app/projects', { headers, data: { name: 'Motion Studio · Keyframe QA' } });
  expect(project.ok()).toBe(true); const id = (await project.json()).id;
  const upload = async (name: string, color: string, size: string) => {
    const buffer = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=${color}:s=${size}`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
    const response = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name, mimeType: 'image/png', buffer } } });
    expect(response.ok()).toBe(true); return (await response.json()).asset;
  };
  const background = await upload('Black stage.png', 'black', '600x400');
  const image = await upload('Motion card.png', 'white', '80x40');
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [
    { type: 'add_clip', clipId: 'base', assetId: background.id, sourceType: 'image', sourceDuration: 4, name: 'Black stage' },
    { type: 'add_overlay', clipId: 'mark', assetId: image.id, name: 'Motion card', startTime: 1, duration: 2, width: .3 },
  ] });
  const read = async () => (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline.document as TimelineDocument;
  const mark = (doc: TimelineDocument) => doc.tracks.flatMap(track => track.clips).find(clip => clip.id === 'mark')!;
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Motion card 2.00s', exact: true }).click();
  await page.getByRole('button', { name: 'Close Inspector', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Animate', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Open Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Animate', exact: true }).click();
  await expect.poll(async () => mark(await read()).motion?.keyframes.length).toBe(2);
  await page.getByRole('button', { name: 'Keyframe 2.00s', exact: true }).click();
  const opacity = page.getByRole('slider', { name: /^Opacity/ });
  await opacity.focus(); await opacity.press('Home');
  for (let n = 0; n < 50; n++) await opacity.press('ArrowRight');
  await expect.poll(async () => mark(await read()).motion?.keyframes[1].opacity).toBe(.5);
  await page.getByRole('button', { name: 'Keyframe 0.00s', exact: true }).click();
  await page.getByLabel('Easing to next keyframe', { exact: true }).selectOption('ease-in-out');
  await expect.poll(async () => mark(await read()).motion?.keyframes[0].easing).toBe('ease-in-out');
  await page.reload();
  await page.getByRole('button', { name: 'Motion card 2.00s', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove animation', exact: true })).toBeVisible();
  const motion = { version: 1, keyframes: [
    { id: 'a', time: 0, x: .25, y: .3, width: .15, opacity: .3, rotation: -40, easing: 'ease-in-out' },
    { id: 'b', time: 2, x: .7, y: .65, width: .35, opacity: .9, rotation: 50, easing: 'linear' },
  ] };
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'set_overlay_motion', clipId: 'mark', motion }] });
  await expect(page.getByRole('slider', { name: /^Rotation/ })).toHaveValue('-40');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const preview = page.getByRole('button', { name: 'Move image overlay: Motion card', exact: true }).locator('..');
  const frameBox = await preview.boundingBox();
  expect(Math.abs(frameBox!.width / frameBox!.height - 16 / 9)).toBeLessThan(.01);
  await page.screenshot({ path: 'test-results/motion-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Remove animation', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel('Easing to next keyframe', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/motion-mobile.png' });
  await page.getByRole('button', { name: 'Close Inspector', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export MP4', exact: true }).click();
  await (await downloaded).saveAs('test-results/motion-browser.mp4');
  const rendered = await mcp(request, 'viral_hit_editor_render', { projectId: id });
  const video = await request.get(rendered.structuredContent.result.asset.publicUrl);
  expect(video.ok()).toBe(true); await writeFile('test-results/motion-server.mp4', await video.body());
  const clip: TimelineClip = mark(await read());
  const measurements = [];
  const pixels = new Map<number, Buffer>();
  for (const name of ['browser', 'server']) for (const time of [.5, 1, 1.5, 2, 2.5, 2.9, 3, 3.5]) {
    const width = 320, height = 180;
    const frame = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', `test-results/motion-${name}.mp4`, '-frames:v', '1', '-vf', `scale=${width}:${height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (frame[(y * width + x) * 3] > 25) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    if (time < 1 || time >= 3) { expect(maxX, `${name} hidden at ${time}`).toBe(-1); continue; }
    const pose = overlayTransformAt(clip, time)!, radians = pose.rotation * Math.PI / 180;
    expect(Math.abs((minX + maxX) / 2 - pose.x * width), `${name} x at ${time}`).toBeLessThan(3);
    expect(Math.abs((minY + maxY) / 2 - pose.y * height), `${name} y at ${time}`).toBeLessThan(3);
    expect(Math.abs(maxX - minX + 1 - pose.width * width * (Math.abs(Math.cos(radians)) + .5 * Math.abs(Math.sin(radians)))), `${name} width at ${time}`).toBeLessThan(5);
    expect(Math.abs(maxY - minY + 1 - pose.width * width * (Math.abs(Math.sin(radians)) + .5 * Math.abs(Math.cos(radians)))), `${name} height at ${time}`).toBeLessThan(5);
    const center = frame[(Math.round(pose.y * height) * width + Math.round(pose.x * width)) * 3];
    expect(Math.abs(center - pose.opacity * 255), `${name} alpha at ${time}`).toBeLessThan(8);
    if (name === 'browser') pixels.set(time, frame);
    else {
      const browser = pixels.get(time)!;
      let changed = 0;
      for (let p = 0; p < frame.length; p += 3) if (Math.abs(frame[p] - browser[p]) > 25) changed++;
      expect(changed / (width * height), `same oriented shape in both exports at ${time}`).toBeLessThan(.015);
    }
    measurements.push({ name, time, pose, bounds: [minX, minY, maxX, maxY], center });
  }
  await writeFile('test-results/motion-frames.json', JSON.stringify({ projectId: id, motion, measurements }, null, 2));
  const portrait = await upload('Portrait source.png', 'blue', '360x640');
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'add_clip', clipId: 'portrait', assetId: portrait.id, sourceType: 'image', sourceDuration: 1, startTime: 4, name: 'Portrait source' }] });
  await page.getByRole('button', { name: 'Portrait source 1.00s', exact: true }).click();
  const switchedFrame = await page.getByRole('img', { name: 'Portrait source', exact: true }).locator('..').boundingBox();
  expect(Math.abs(switchedFrame!.width / switchedFrame!.height - 16 / 9)).toBeLessThan(.01);

});

test('a portrait first visual keeps the export frame fitted on desktop and phone', async ({ page, request }) => {
  const project = await request.post('/api/app/projects', { headers, data: { name: 'Portrait frame QA' } });
  const id = (await project.json()).id;
  const buffer = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=400x600', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
  const upload = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name: 'Portrait.png', mimeType: 'image/png', buffer } } });
  const asset = (await upload.json()).asset;
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'add_clip', clipId: 'portrait', assetId: asset.id, sourceType: 'image', sourceDuration: 2, name: 'Portrait frame' }] });
  await page.goto(`/editor/${id}`);
  const frame = page.getByRole('img', { name: 'Portrait frame', exact: true }).locator('..');
  for (const size of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => { const box = await frame.boundingBox(); return box ? Math.abs(box.width / box.height - 9 / 16) : 1; }).toBeLessThan(.01);
    const box = (await frame.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    expect(box.height).toBeGreaterThan(0); expect(box.y + box.height).toBeLessThanOrEqual(size.height);
  }
});
