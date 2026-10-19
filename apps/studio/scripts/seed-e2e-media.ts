// Test-only fixture creation. Never used by the normal server or worker entry points.
import { copyFile } from 'node:fs/promises';
import { createProject } from '../src/core/projects/projects';
import { openHarness } from '../src/core/harness/store';
import { createMaterializeAdapter } from '../src/core/harness/materialize';
import { probeMedia } from '../src/core/harness/probe-media';
const project = await createProject({ name: 'Materialized media E2E fixture' });
const h = openHarness();
try {
  const adapter = createMaterializeAdapter({ download: async (_url, destination) => { await copyFile('public/logo.png', destination); }, probe: probeMedia });
  const run = h.enqueue({ projectId: project.id, nodes: [{ id: 'imported-image', operation: 'asset.materialize', version: 'fixture', input: { url: 'https://example.invalid/test-fixture.png', kind: 'image', label: 'Imported E2E fixture' } }] }, 'fixture');
  await h.step(run, { 'asset.materialize': adapter }); await h.step(run, { 'asset.materialize': adapter });
  if (h.jobs(run)[0].state !== 'succeeded') throw new Error('Could not create materialized media fixture');
} finally { h.close(); }

// Encoded fixture bytes travel through the same recipe/Router/materialization contract as model outputs.
const { readFile } = await import('node:fs/promises');
const { execFileSync } = await import('node:child_process');
const { join } = await import('node:path');
const { getViralHitDataRoot } = await import('../src/config/data-root');
const { createDemoMedia } = await import('./demo-media.mjs');
const { createComfyRouterAdapter } = await import('../src/core/harness/comfy-router');
const { compileRecipe } = await import('../src/core/harness/recipes');
const mediaProject = await createProject({ name: 'Multimodal E2E fixture' });
const video = join(getViralHitDataRoot(), 'fixture-motion.mp4'); createDemoMedia(video);
const audio = join(getViralHitDataRoot(), 'fixture-tone.mp3');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:a', 'libmp3lame', audio]);
const audioBytes = await readFile(audio);
const router = createComfyRouterAdapter({
  async submit(model: string) { return { requestId: `fixture-${model}` }; },
  handle(model: string) { return {
    async status() { return { completed: true }; },
    async get() { return model.startsWith('elevenlabs/')
      ? { kind: 'binary', data: audioBytes, requestId: 'fixture-audio', contentType: 'audio/mpeg', creditsUsed: null }
      : { kind: 'json', requestId: 'fixture-video', data: { code: 0, data: [{ id: 'fixture-task', status: 'succeeded', outputs: [{ type: 'video', url: 'https://example.invalid/fixture-motion.mp4' }] }] } }; },
  }; },
} as unknown as Parameters<typeof createComfyRouterAdapter>[0]);
const ledger = openHarness();
try {
  const adapter = createMaterializeAdapter({ download: async (url, destination) => { if (url !== 'https://example.invalid/fixture-motion.mp4') throw new Error('Unexpected fixture download'); await copyFile(video, destination); }, probe: probeMedia });
  for (const [recipeId, values] of [
    ['open-motion', { prompt: 'Procedural motion fixture, not AI generation', duration: 3 }],
    ['spoken-line', { text: 'Encoded tone fixture, not generated speech', voice: 'fixture-voice' }],
  ] as const) {
    const recipe = JSON.parse(await readFile(`../../recipes/${recipeId}.json`, 'utf8'));
    const run = ledger.enqueue(compileRecipe(recipe, values, mediaProject.id), recipeId);
    for (let i = 0; i < 4; i++) await ledger.step(run, { 'comfy.router': router, 'asset.materialize': adapter });
    if (ledger.jobs(run).some(job => job.state !== 'succeeded')) throw new Error(`Could not create ${recipeId} fixture`);
  }
} finally { ledger.close(); }

// Distinct source colors make source selection observable in decoded exports.
const takeProject = await createProject({ name: 'Take E2E fixture' });
const { persistViralHitCommand } = await import('../src/core/commands/persist');
const takeLedger = openHarness();
try {
  for (const [name, color] of [['Original coral', '0xe94455'], ['Alternative lime', '0x99ee33']] as const) {
    const image = join(getViralHitDataRoot(), `${name}.png`);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x320`, '-frames:v', '1', image]);
    const adapter = createMaterializeAdapter({ download: async (_url, destination) => { await copyFile(image, destination); }, probe: probeMedia });
    const run = takeLedger.enqueue({ projectId: takeProject.id, nodes: [{ id: 'image', operation: 'asset.materialize', version: 'fixture', input: { url: 'https://example.invalid/take.png', kind: 'image', label: name } }] }, name);
    await takeLedger.step(run, { 'asset.materialize': adapter }); await takeLedger.step(run, { 'asset.materialize': adapter });
    const job = takeLedger.jobs(run)[0]; if (job.state !== 'succeeded') throw new Error('Take fixture failed');
    if (name === 'Original coral') {
      const asset = JSON.parse(job.output_json!);
      const result = await persistViralHitCommand({ projectId: takeProject.id, origin: 'system', commandId: 'seed-take-timeline', expectedRevision: 0, command: { type: 'editor.apply', operations: [
        { type: 'add_clip', clipId: 'take-target', assetId: asset.assetId, sourceUrl: asset.publicUrl, name: 'Opening scene', sourceType: 'image', sourceDuration: 2 },
        { type: 'add_clip', clipId: 'take-neighbor', assetId: asset.assetId, sourceUrl: asset.publicUrl, name: 'Closing scene', sourceType: 'image', sourceDuration: 2 },
      ] } }); if (!result.ok) throw new Error(result.message);
    }
  }
} finally { takeLedger.close(); }
