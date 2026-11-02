import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';

async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result;
}
const seconds = (label: string) => { const [minutes, rest] = label.split(':'); return Number(minutes) * 60 + Number(rest); };

test('Play runs the whole timeline: video to video through a transition, a gap in black, then an image, to the end', async ({ page, request }) => {
  test.setTimeout(120_000);
  const id = (await (await request.post('/api/app/projects', { headers, data: { name: 'Playback QA' } })).json()).id;
  const directory = mkdtempSync(join(tmpdir(), 'vh-playback-'));
  const upload = async (name: string, mimeType: string, args: string[]) => {
    const file = join(directory, name);
    execFileSync(ffmpeg, ['-v', 'error', '-y', ...args, file]);
    const buffer = readFileSync(file);
    const response = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name, mimeType, buffer } } });
    expect(response.ok()).toBe(true);
    return (await response.json()).asset;
  };
  const clip = (color: string) => ['-f', 'lavfi', '-i', `color=${color}:s=320x180:r=30:d=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  const first = await upload('Red.mp4', 'video/mp4', clip('red'));
  const second = await upload('Blue.mp4', 'video/mp4', clip('blue'));
  const still = await upload('Lime.png', 'image/png', ['-f', 'lavfi', '-i', 'color=lime:s=320x180', '-frames:v', '1']);
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [
    { type: 'add_clip', clipId: 'red', assetId: first.id, sourceType: 'video', sourceDuration: 2, name: 'Red' },
    { type: 'add_clip', clipId: 'blue', assetId: second.id, sourceType: 'video', sourceDuration: 2, startTime: 2, name: 'Blue' },
    { type: 'set_transition', clipId: 'blue', transition: { kind: 'crossfade', duration: 0.5 } },
    { type: 'add_clip', clipId: 'lime', assetId: still.id, sourceType: 'image', sourceDuration: 1, startTime: 4.5, name: 'Lime' },
  ] });
  await page.goto(`/editor/${id}`);
  const timer = page.getByRole('timer', { name: 'Playhead time' });
  await expect.poll(async () => seconds((await timer.textContent()) ?? '9:99')).toBeLessThan(0.2);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  const samples: { time: number; src: string | null; hidden: boolean }[] = [];
  const started = Date.now();
  while (Date.now() - started < 9_000) {
    const time = seconds((await timer.textContent()) ?? '0:00');
    const media = await page.evaluate(() => {
      const element = document.querySelector('video[aria-label]:not([aria-hidden]), img[alt]:not([alt=""])') as HTMLVideoElement | HTMLImageElement | null;
      return element ? { src: element.getAttribute('src'), hidden: getComputedStyle(element).visibility === 'hidden' } : { src: null, hidden: true };
    });
    samples.push({ time, ...media });
    if (await page.getByRole('button', { name: 'Play', exact: true }).isVisible()) break;
    await page.waitForTimeout(100);
  }
  await expect(timer).toHaveText('0:05.50');
  for (let index = 1; index < samples.length; index += 1) expect(samples[index].time, JSON.stringify(samples)).toBeGreaterThanOrEqual(samples[index - 1].time);
  expect(samples.some(sample => sample.time > 2.3 && sample.time < 3.9 && sample.src?.includes(second.id)), 'the second video plays after the cut').toBe(true);
  expect(samples.some(sample => sample.time > 4.05 && sample.time < 4.45 && sample.hidden), 'the gap is black').toBe(true);
  expect(samples.some(sample => sample.time > 4.6 && sample.src?.includes(still.id) && !sample.hidden), 'the image follows the gap').toBe(true);
  expect(Math.max(...samples.map(sample => sample.time))).toBeGreaterThan(5);
});

