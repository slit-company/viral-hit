import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const headers = { 'x-viral-hit-workspace-request': '1' };
const endpoint = '/api/app/comfy-connection';

test("a ComfyUI canvas workflow with subgraphs converts with the connected server's node definitions into a recipe", async ({ page, request }) => {
  test.setTimeout(120_000);
  // Node definitions captured from Comfy Cloud's object_info, served the way a ComfyUI server serves them.
  const definitions = await readFile('src/core/harness/fixtures/comfy/cloud-definitions.json', 'utf8');
  const canvas = await readFile('src/core/harness/fixtures/comfy/canvas-minimax-h3-background-swap.json');
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(req.url === '/object_info' ? definitions : JSON.stringify({ system: { comfyui_version: 'test-server' }, devices: [{ type: 'cpu' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const initial = await (await request.get(endpoint)).json();
  expect((await request.post(endpoint, { headers, data: { action: 'save', url, expectedRevision: initial.revision } })).ok()).toBe(true);
  try {
    const id = (await (await request.post('/api/app/projects', { headers, data: { name: 'Canvas import QA' } })).json()).id;
    await page.goto(`/editor/${id}`);
    await page.getByRole('button', { name: 'Generation runs', exact: true }).click();
    await page.getByRole('button', { name: 'Recipe library', exact: true }).click();
    await page.getByRole('button', { name: /Import ComfyUI workflow/ }).click();
    await page.getByLabel('Import ComfyUI workflow file').setInputFiles({ name: 'minimax-canvas.json', mimeType: 'application/json', buffer: canvas });
    await page.getByRole('button', { name: 'Inspect workflow', exact: true }).click();
    const status = page.getByRole('status').filter({ hasText: 'Converted with' });
    await expect(status).toContainText('your ComfyUI server’s node definitions');
    await expect(status).toContainText('"example.mp4" is not available on this server for video');
    expect(seen).toContain('GET /object_info');
    const nodes = page.getByLabel('Inspect node', { exact: true });
    await expect(nodes.locator('option', { hasText: '#141:136 ' })).toHaveCount(1);
    await expect(nodes.locator('option', { hasText: 'Reroute' })).toHaveCount(0);

    await page.getByLabel('Recipe name', { exact: true }).fill('Video background swap');
    await page.getByLabel('Recipe ID', { exact: true }).fill('canvas-background-swap');
    await page.getByLabel('Source author', { exact: true }).fill('Viral Hit');
    await page.getByLabel('Source license', { exact: true }).fill('Apache-2.0');
    await page.getByLabel('Recipe description', { exact: true }).fill('Replaces the background behind a moving subject.');
    await nodes.selectOption('141:165');
    await page.getByLabel('Expose #141:165 replace', { exact: true }).check();
    await page.getByLabel('Control label for #141:165 replace', { exact: true }).fill('Swap instruction');
    await page.getByLabel('Control ID for #141:165 replace', { exact: true }).fill('swap');
    await page.getByLabel('Output node', { exact: true }).selectOption('92');
    await page.getByLabel('Output array', { exact: true }).selectOption('images');
    await page.getByLabel('Media kind', { exact: true }).selectOption('video');
    await page.getByRole('button', { name: 'Build recipe for review', exact: true }).click();
    const review = page.getByRole('region', { name: 'Recipe inspection', exact: true });
    await expect(review).toContainText('2 steps · 1 input');
    const recipe = JSON.parse(await page.getByLabel('Recipe JSON', { exact: true }).inputValue());
    const workflow = recipe.nodes.find((node: { operation: string }) => node.operation === 'comfy.workflow').input.workflow;
    expect(workflow['141:136'].class_type).toBe('MiniMaxH3ReferenceToVideo');
    expect(workflow['141:136'].inputs['ref_images.ref_image_0']).toEqual(['137', 0]);
    expect(Object.values(workflow).some((node) => (node as { class_type: string }).class_type === 'Reroute')).toBe(false);
    expect(recipe.parameters).toEqual([expect.objectContaining({ id: 'swap', label: 'Swap instruction', type: 'string' })]);
    await page.screenshot({ path: 'test-results/comfy-canvas-import.png' });
  } finally {
    server.close();
    const current = await (await request.get(endpoint)).json();
    await request.post(endpoint, { headers, data: { action: 'save', url: null, expectedRevision: current.revision } });
  }
});
