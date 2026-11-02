import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TimelineDocument } from '../../src/core/editor/timeline-document';

const headers = { 'x-viral-hit-workspace-request': '1' };
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
async function mcp(request: APIRequestContext, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_remix', arguments: args } },
  });
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent.result;
}

test('Remix keeps a reference video\'s cuts and soundtrack and rebuilds them with new material', async ({ page, request }) => {
  test.setTimeout(180_000);
  const id = (await (await request.post('/api/app/projects', { headers, data: { name: 'Remix QA' } })).json()).id;
  const directory = mkdtempSync(join(tmpdir(), 'vh-remix-'));
  const upload = async (name: string, mimeType: string, args: string[]) => {
    const file = join(directory, name);
    execFileSync(ffmpeg, ['-v', 'error', '-y', ...args, file]);
    const response = await request.post(`/api/app/projects/${id}/assets`, { headers, multipart: { file: { name, mimeType, buffer: readFileSync(file) } } });
    expect(response.ok()).toBe(true);
    return (await response.json()).asset;
  };
  // Three hard cuts at 1 s and 2 s with a tone underneath: the edit grammar and soundtrack to keep.
  await upload('Reference.mp4', 'video/mp4', ['-f', 'lavfi', '-i', 'color=red:s=320x180:r=30:d=1', '-f', 'lavfi', '-i', 'color=lime:s=320x180:r=30:d=1', '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=30:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart']);
  const still = await upload('Yellow.png', 'image/png', ['-f', 'lavfi', '-i', 'color=yellow:s=320x180', '-frames:v', '1']);
  const motion = await upload('Magenta.mp4', 'video/mp4', ['-f', 'lavfi', '-i', 'color=magenta:s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']);
  const env = JSON.parse(await readFile(join(tmpdir(), 'viral-hit-e2e-worker.json'), 'utf8'));
  const worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/harness-worker.ts'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  try {
    await page.goto(`/remix/${id}`);
    await page.getByRole('group', { name: 'Reference video' }).getByRole('button', { name: 'Reference.mp4' }).click();
    await page.getByRole('button', { name: 'Find the cuts', exact: true }).click();
    await expect(page.getByText('3 shots · 1.0s average · 40 cuts per minute', { exact: true })).toBeVisible({ timeout: 60_000 });
    const material = page.getByRole('group', { name: 'Your material' });
    await material.getByRole('button', { name: 'Yellow.png' }).click();
    await material.getByRole('button', { name: 'Magenta.mp4' }).click();
    await page.getByRole('combobox', { name: 'Between shots', exact: true }).selectOption('crossfade');
    await page.screenshot({ path: 'test-results/remix-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Build the remix on the timeline', exact: true }).click();
    await expect(page.getByText('Added 3 shots to the timeline.', { exact: false })).toBeVisible({ timeout: 30_000 });
    const read = async () => (await (await request.get(`/api/app/projects/${id}/timeline`)).json()).timeline.document as TimelineDocument;
    const timeline = await read();
    const visuals = timeline.tracks.filter((track) => track.kind === 'video').flatMap((track) => track.clips);
    expect(visuals.map((clip) => [clip.startTime, clip.duration, clip.assetId])).toEqual([[0, 1, still.id], [1, 1, motion.id], [2, 1, still.id]]);
    expect(visuals.map((clip) => clip.transition?.kind ?? null)).toEqual([null, 'crossfade', 'crossfade']);
    const audio = timeline.tracks.filter((track) => track.kind === 'audio').flatMap((track) => track.clips);
    expect(audio).toHaveLength(1);
    expect(audio[0].audioRole).toBe('music');
    expect(Math.abs(audio[0].duration - 3)).toBeLessThan(0.1);
    const listed = await mcp(request, { projectId: id, request: { action: 'list' } });
    expect(listed.remixes[0].grammar.shots.map((shot: { start: number }) => shot.start)).toEqual([0, 1, 2]);
    const again = await mcp(request, { projectId: id, request: { action: 'build', requestId: listed.remixes[0].requestId, materials: [motion.id], keepSoundtrack: false } });
    expect(again.offset).toBe(3);
    expect(again.shots.map((shot: { start: number }) => shot.start)).toEqual([3, 4, 5]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/remix-mobile.png' });
  } finally {
    const exit = new Promise((resolve) => worker.once('exit', resolve)); worker.kill('SIGTERM'); await exit;
  }
});

