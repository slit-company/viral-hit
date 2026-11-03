import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
type Clip = { id: string; sourceType: string; audioRole?: string; muted: boolean; startTime: number; duration: number; inPoint: number; outPoint: number; activeTakeId: string | null; takes: { id: string; assetId: string }[] };

async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const response = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  const text = await response.text();
  const rpc = JSON.parse(text.startsWith('{') ? text : text.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.result?.isError, JSON.stringify(rpc.result)).not.toBe(true);
  return rpc.result.structuredContent.result;
}

test('a clip swaps to a character through a reference-to-video run and lands as a take with its original sound kept', async ({ page, request }) => {
  test.setTimeout(150_000);
  const face = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=0xdb2777:s=320x400', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
  const created = await request.post('/api/app/characters', { headers, multipart: {
    request: JSON.stringify({ action: 'create', profile: { name: 'Swap Mina', kind: 'illustrated', description: 'Pink coat', invariants: [], forbidden: [], providerIdentities: [] } }),
    roles: JSON.stringify(['canonical']), file: { name: 'mina.png', mimeType: 'image/png', buffer: face } } });
  expect(created.ok(), await created.text()).toBe(true);
  const characterId = (await created.json()).id as string;
  const id = (await (await request.post('/api/app/projects', { headers, data: { name: 'Swap QA' } })).json()).id;
  const clip = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=3:r=24', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-']);
  const video = (await (await request.post('/api/app/projects/' + id + '/assets', { headers, multipart: { file: { name: 'actor.mp4', mimeType: 'video/mp4', buffer: clip } } })).json()).asset;
  await mcp(request, 'viral_hit_editor_edit', { projectId: id, operations: [{ type: 'add_clip', clipId: 'actor', assetId: video.id, sourceUrl: video.publicUrl, name: 'Actor', sourceType: 'video', sourceDuration: 3, startTime: 0 }] });

  const env = JSON.parse(await readFile(join(tmpdir(), 'viral-hit-e2e-worker.json'), 'utf8'));
  const worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/harness-worker.ts'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  try {
    await page.goto('/editor/' + id);
    await page.getByRole('button', { name: /Actor/ }).first().click();
    await page.getByRole('button', { name: 'Swap character' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Model', { exact: true }).selectOption('cinema-swap-fixture');
    await expect(dialog.getByText('Pieces: 1')).toBeVisible();
    await dialog.getByRole('button', { name: 'Start the swap' }).click();
    await expect(dialog.getByRole('button', { name: 'Use on the timeline' })).toBeEnabled({ timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Use on the timeline' }).click();
    await expect(dialog.getByRole('button', { name: 'Applied as a take' })).toBeVisible();

    const planned = (await mcp(request, 'viral_hit_character_swap', { projectId: id, request: { action: 'plan', clipId: 'actor', modelId: 'cinema-swap-fixture', characterId } })).plan;
    expect(planned.prompt).toMatch(/^Replace the person in the reference video with the character from the reference image\. Take only the face, hair, outfit and body shape/);
    expect(planned.pieces).toEqual([{ start: 0, duration: 3, outputDuration: '3s' }]);
    const swaps = (await mcp(request, 'viral_hit_character_swap', { projectId: id, request: { action: 'list' } })).swaps;
    expect(swaps).toHaveLength(1);
    expect(swaps[0].pieces).toMatchObject([{ start: 0, state: 'succeeded' }]);
    const document = (await (await request.get('/api/app/projects/' + id + '/timeline')).json()).timeline.document;
    const clips = document.tracks.flatMap((track: { clips: Clip[] }) => track.clips) as Clip[];
    const actor = clips.find(item => item.id === 'actor')!;
    expect(actor.activeTakeId).toMatch(/^swap-/);
    expect(actor.takes.find(take => take.id === actor.activeTakeId)?.assetId).toBe(swaps[0].pieces[0].outputAssetId);
    expect(actor.muted).toBe(true);
    const sound = clips.find(item => item.audioRole === 'source')!;
    expect(sound).toMatchObject({ sourceType: 'audio', startTime: 0, inPoint: 0 });
    expect(sound.outPoint).toBeCloseTo(3, 1);
  } finally {
    const exit = new Promise(resolve => worker.once('exit', resolve)); worker.kill('SIGTERM'); await exit;
  }
});
