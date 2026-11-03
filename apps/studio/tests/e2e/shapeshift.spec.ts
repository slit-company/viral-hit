import { test, expect, type APIRequestContext } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ffprobe = process.env.VIRAL_HIT_FFPROBE || 'ffprobe';
type Variation = { modelId: string; best: boolean; resultAssetId: string | null; resultUrl: string | null; scores: { motion: number | null; verdict: string | null } | null };

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

// Local fixtures stand in for paid models: one returns each piece's own frames, the other plays them backwards.
test('a video changes its subject on two models; the one that keeps the motion is marked best and goes on the timeline', async ({ page, request }) => {
  test.setTimeout(180_000);
  // A box moving at changing speed for 7 seconds, with sound.
  const clip = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x101828:s=320x180:d=7:r=24', '-f', 'lavfi', '-i', 'color=c=white:s=40x40:d=7:r=24',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=7', '-filter_complex', "[0:v][1:v]overlay=x='mod(t*70\\,280)':y='70+50*sin(t*2.2)':shortest=1,format=yuv420p[v]",
    '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-']);
  const picture = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=0xdb2777:s=320x400', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
  const id = (await (await request.post('/api/app/projects', { headers, data: { name: 'Shapeshift QA' } })).json()).id;
  const upload = async (name: string, mimeType: string, buffer: Buffer) => (await (await request.post('/api/app/projects/' + id + '/assets', { headers, multipart: { file: { name, mimeType, buffer } } })).json()).asset;
  const video = await upload('moving-box.mp4', 'video/mp4', clip), subject = await upload('subject.png', 'image/png', picture);

  // Auto tries the service that reports credit first and gives each variation its own model; nothing is spent.
  const plan = (await mcp(request, 'viral_hit_shapeshift', { projectId: id, request: { action: 'plan', mode: 'object-swap', sourceAssetId: video.id, imageAssetIds: [subject.id], variations: 2 } })).plan;
  expect(plan.takes.map((take: { modelId: string }) => take.modelId)).toEqual(['shapeshift-follow-fixture', 'shapeshift-mirror-fixture']);
  expect(plan.takes[0].pieces).toHaveLength(2);
  expect(plan.takes[0].pieces[1].start).toBeCloseTo(plan.duration / 2, 2);
  expect(plan.takes[0].prompt).toMatch(/^Replace the main subject of the reference video with the subject from the reference image\./);

  const env = JSON.parse(await readFile(join(tmpdir(), 'viral-hit-e2e-worker.json'), 'utf8'));
  const worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/harness-worker.ts'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  try {
    await page.goto('/shapeshift/' + id);
    // The empty results message renders only after the page is interactive and has loaded its runs.
    await expect(page.getByText('Your results appear here')).toBeVisible();
    await page.getByRole('button', { name: /^Object swap/ }).click();
    await expect(page.getByRole('button', { name: /^Object swap/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Choose video' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'moving-box.mp4' }).click();
    await page.getByRole('button', { name: 'Add pictures' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'subject.png' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await page.getByRole('group', { name: 'Variations' }).getByRole('button', { name: '2' }).click();
    await expect(page.getByText('Generations: 4')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Local follow fixture · pieces: 2')).toBeVisible();
    await page.getByRole('button', { name: 'Generate' }).click();

    // The page joins each variation as soon as its pieces arrive, scores it and marks the best.
    const best = page.locator('figure').filter({ has: page.getByText('Best', { exact: true }) });
    await expect(best.getByText('Local follow fixture')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('figure').filter({ hasText: 'Local mirror fixture' }).getByRole('button', { name: 'Add to timeline' })).toBeVisible({ timeout: 60_000 });
    await best.getByRole('button', { name: 'Add to timeline' }).click();
    await expect(best.getByRole('link', { name: 'Added · open editor' })).toBeVisible();

    const [run] = (await mcp(request, 'viral_hit_shapeshift', { projectId: id, request: { action: 'list' } })).shapeshifts;
    const [follow, mirror] = run.variations as Variation[];
    expect(follow).toMatchObject({ modelId: 'shapeshift-follow-fixture', best: true });
    expect(follow.scores!.motion).toBeGreaterThan(0.9);
    expect(mirror.scores!.motion).toBeLessThan(0.5);
    // A plain colour picture has no face, so only motion decides.
    expect(follow.scores!.verdict).toBeNull();

    // The result has the source's length and sound, at 720p in the source's shape.
    const directory = await mkdtemp(join(tmpdir(), 'vh-shapeshift-e2e-'));
    try {
      const file = join(directory, 'result.mp4');
      await writeFile(file, await (await request.get(follow.resultUrl!)).body());
      const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' }));
      expect(Math.abs(Number(probe.format.duration) - run.duration)).toBeLessThan(0.1);
      expect(probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')).toMatchObject({ width: 1280, height: 720 });
      expect(probe.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio')).toBe(true);
    } finally { await rm(directory, { recursive: true, force: true }); }
    const timeline = (await (await request.get('/api/app/projects/' + id + '/timeline')).json()).timeline.document;
    expect(JSON.stringify(timeline)).toContain(follow.resultAssetId);
  } finally {
    const exit = new Promise(resolve => worker.once('exit', resolve)); worker.kill('SIGTERM'); await exit;
  }
});
