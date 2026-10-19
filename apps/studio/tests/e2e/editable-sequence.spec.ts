import { test, expect } from '@playwright/test';

test('prepared sequence appends editable tracks and caption changes persist without flattening', async ({ page, request }) => {
  const data = await (await request.get('/api/app/projects')).json();
  const project = data.projects.find((p: { name: string }) => p.name === 'Editable sequence E2E fixture');
  expect(project).toBeTruthy(); const id = project.id;
  await page.goto(`/editor/${id}`);
  await page.getByRole('button', { name: 'Generation runs' }).click();
  await page.getByRole('combobox', { name: 'Creative recipe' }).selectOption('editable-image-story');
  await expect(page.getByRole('button', { name: 'Queue workflow', exact: true })).toBeDisabled();
  await expect(page.getByText('Edit ready', { exact: true })).toBeVisible();
  await expect(page.getByText('Separate tracks for editing. Appends after your current timeline.')).toBeVisible();
  await page.screenshot({ path: 'test-results/sequence-ready-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Add editable sequence', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Add editable sequence', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/sequence-ready-mobile.png' });
  const attached = page.waitForResponse(response => response.url().endsWith(`/projects/${id}/runs`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add editable sequence', exact: true }).click();
  expect((await (await attached).json()).ok).toBe(true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'EDIT THIS TITLE 3.00s', exact: true }).click();
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/commands'));
  await page.locator('textarea').first().fill('MY EDITABLE STORY');
  expect((await (await saved).json()).ok).toBe(true);
  await expect.poll(async () => {
    const state = await (await request.get(`/api/app/projects/${id}/timeline`)).json();
    return state.timeline.document.tracks.flatMap((track: { clips: { text?: string }[] }) => track.clips).find((clip: { text?: string }) => clip.text === 'MY EDITABLE STORY')?.text;
  }).toBe('MY EDITABLE STORY');
  await page.reload();
  await expect(page.getByRole('button', { name: 'MY EDITABLE STORY 3.00s', exact: true })).toBeVisible();
  const state = await (await request.get(`/api/app/projects/${id}/timeline`)).json();
  const clips = state.timeline.document.tracks.flatMap((track: { clips: { sourceType: string }[] }) => track.clips);
  expect(clips.map((clip: { sourceType: string }) => clip.sourceType).sort()).toEqual(['caption', 'image']);
  const runs = await (await request.get(`/api/app/projects/${id}/runs`)).json();
  const run = runs.runs[0], job = run.jobs.find((job: { operation: string }) => job.operation === 'editor.sequence');
  const replay = await request.post('http://127.0.0.1:3043/mcp', {
    headers: { authorization: 'Bearer e2e-local-only', accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'viral_hit_runs_change', arguments: { projectId: id, request: { action: 'attach', runId: run.id, jobId: job.id, expectedRevision: 0 } } } },
  });
  expect(replay.ok()).toBe(true); const body = await replay.text();
  const rpc = JSON.parse(body.startsWith('{') ? body : body.split('\n').find(line => line.startsWith('data: '))!.slice(6));
  expect(rpc.error).toBeUndefined(); expect(rpc.result?.isError).not.toBe(true);
  const recovered = await (await request.get(`/api/app/projects/${id}/timeline`)).json();
  expect(recovered.timeline).toEqual(state.timeline);
  await page.screenshot({ path: 'test-results/sequence-edited-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/sequence-edited-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
