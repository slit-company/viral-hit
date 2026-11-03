import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const headers = { 'x-viral-hit-workspace-request': '1' };
type Clip = { id: string; startTime: number; duration: number; audioRole?: string; sourceType: string; text?: string };

test('a two-voice dialogue is voiced line by line and placed in order with captions', async ({ page, request }) => {
  test.setTimeout(150_000);
  // Lines run as durable jobs, so the real harness worker processes them.
  const env = JSON.parse(await readFile(join(tmpdir(), 'viral-hit-e2e-worker.json'), 'utf8'));
  const worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/harness-worker.ts'], { env: { ...process.env, ...env }, stdio: 'ignore' });
  try {
    const id = (await (await request.post('/api/app/projects', { headers, data: { name: 'Dialogue QA' } })).json()).id;
    await page.goto('/editor/' + id);
    await page.getByRole('button', { name: 'Voice a dialogue' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Script').fill('Mina: Find the hit first\nJun: Then make it ours');
    await expect(dialog.getByLabel('Mina', { exact: true })).toHaveValue('low');
    await expect(dialog.getByLabel('Jun', { exact: true })).toHaveValue('high');
    await dialog.getByRole('button', { name: 'Voice 2 lines' }).click();
    await expect(dialog.getByRole('button', { name: 'Add to timeline in order' })).toBeEnabled({ timeout: 60_000 });
    await dialog.getByRole('button', { name: 'Add to timeline in order' }).click();
    await expect(dialog.getByRole('button', { name: 'Added to the timeline' })).toBeVisible();

    const dialogues = (await (await request.get('/api/app/projects/' + id + '/dialogues')).json()).dialogues;
    expect(dialogues[0].lines.map((line: { speaker: string; voice: string }) => [line.speaker, line.voice])).toEqual([['Mina', 'low'], ['Jun', 'high']]);
    const document = (await (await request.get('/api/app/projects/' + id + '/timeline')).json()).timeline.document;
    const clips = document.tracks.flatMap((track: { clips: Clip[] }) => track.clips) as Clip[];
    const voices = clips.filter(clip => clip.audioRole === 'voice').sort((a, b) => a.startTime - b.startTime);
    expect(voices).toHaveLength(2);
    expect(voices[0].startTime).toBe(0);
    expect(voices[1].startTime).toBeCloseTo(voices[0].duration + 0.3, 2);
    expect(clips.filter(clip => clip.sourceType === 'caption').map(clip => clip.text).join(' ')).toContain('Then make it ours');
  } finally {
    const exit = new Promise(resolve => worker.once('exit', resolve)); worker.kill('SIGTERM'); await exit;
  }
});
