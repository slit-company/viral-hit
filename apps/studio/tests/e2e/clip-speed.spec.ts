import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ffprobe = process.env.VIRAL_HIT_FFPROBE || 'ffprobe';

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

test('a 2× clip renders in half the time with its later frames and pushes the next clip earlier', async ({ page, request }) => {
  test.setTimeout(180_000);
  const id = (await (await request.post('/api/app/projects', { headers, data: { name: 'Speed QA' } })).json()).id;
  // Red for two seconds, then blue for two: at 2× the blue half starts one second in.
  const folder = mkdtempSync(join(tmpdir(), 'speed-')), source = join(folder, 'halves.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x180:d=2:r=30', '-f', 'lavfi', '-i', 'color=blue:s=320x180:d=2:r=30', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source]);
  const still = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=green:s=320x180', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
  writeFileSync(join(folder, 'green.png'), still);
  const upload = async (name: string, mimeType: string, buffer: Buffer) => (await (await request.post('/api/app/projects/' + id + '/assets', { headers, multipart: { file: { name, mimeType, buffer } } })).json()).asset;
  const video = await upload('halves.mp4', 'video/mp4', execFileSync('cat', [source])), green = await upload('green.png', 'image/png', still);
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [
    { type: 'add_clip', clipId: 'halves', assetId: video.id, sourceUrl: video.publicUrl, name: 'Halves', sourceType: 'video', sourceDuration: 4, startTime: 0 },
    { type: 'add_clip', clipId: 'green', assetId: green.id, sourceUrl: green.publicUrl, name: 'Green', sourceType: 'image', sourceDuration: 1, startTime: 4 },
    { type: 'set_clip_speed', clipId: 'halves', speed: 2 },
  ] });
  const timeline = (await (await request.get('/api/app/projects/' + id + '/timeline')).json()).timeline.document;
  const clips = timeline.tracks.flatMap((track: { clips: { id: string; startTime: number; duration: number; speed?: number }[] }) => track.clips);
  expect(clips.find((clip: { id: string }) => clip.id === 'halves')).toMatchObject({ duration: 2, speed: 2 });
  expect(clips.find((clip: { id: string }) => clip.id === 'green')?.startTime).toBe(2);

  const rendered = await mcp(request, 'viral_hit_editor_render', { projectId: id });
  const file = join(folder, 'render.mp4');
  writeFileSync(file, Buffer.from(await (await request.get(rendered.structuredContent.result.asset.publicUrl)).body()));
  expect(Number(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())).toBeCloseTo(3, 1);
  const color = (time: number) => [...execFileSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
  expect(color(0.5)[0]).toBeGreaterThan(200);
  expect(color(1.5)[2]).toBeGreaterThan(200);
  expect(color(2.5)[1]).toBeGreaterThan(100);

  await page.goto('/editor/' + id);
  await page.getByRole('button', { name: /Halves/ }).first().click();
  await expect(page.getByLabel('Speed')).toHaveValue('2');
  await expect(page.getByText('At another speed the clip plays without its own sound', { exact: false })).toBeVisible();
});
