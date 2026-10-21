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

// Real reference sampling; no remote download or paid generation in the browser fixture.
const { importLocalProjectAsset } = await import('../src/core/projects/import-local-asset');
const { pinRuntimePlan } = await import('../src/core/harness/runtime-plan');
const { createReferenceAdapter } = await import('../src/core/references/recipe-adapters.server');
const referenceProject = await createProject({ name: 'Reference samples E2E fixture' });
const referenceSource = await importLocalProjectAsset({ projectId: referenceProject.id, filePath: video });
const referenceHarness = openHarness();
try {
  const plan = await pinRuntimePlan({ projectId: referenceProject.id, nodes: [{ id: 'reference', operation: 'reference.sample', version: '1', input: { assetId: referenceSource.id } }] });
  const run = referenceHarness.enqueue(plan, 'reference-fixture'), adapters = { 'reference.sample': createReferenceAdapter('reference.sample') };
  await referenceHarness.step(run, adapters); await referenceHarness.step(run, adapters);
  if (referenceHarness.jobs(run)[0].state !== 'succeeded') throw new Error('Reference fixture failed');
} finally { referenceHarness.close(); }

const { mkdir, writeFile } = await import('node:fs/promises');
await mkdir('../../research/evidence/reference-recipes', { recursive: true });
await writeFile('../../research/evidence/reference-recipes/fixture.json', JSON.stringify({ projectId: referenceProject.id }));

// Account fixture uses the real encrypted store and application service with a bounded protocol fixture.
const { openYouTubeAccounts } = await import('../src/core/publishing/youtube-accounts.server');
const { YOUTUBE_OAUTH_SCOPES } = await import('../src/core/publishing/google-oauth.server');
const accounts = openYouTubeAccounts({ fetch: async (url) => {
  if (String(url) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'e2e-token', refresh_token: 'e2e-refresh', token_type: 'Bearer', expires_in: 3600, scope: YOUTUBE_OAUTH_SCOPES.join(' ') });
  if (String(url).startsWith('https://www.googleapis.com/youtube/v3/channels?')) return Response.json({ items: [{ id: 'e2e-channel', snippet: { title: 'Open Studio · Stories, experiments and creative projects' } }] });
  throw new Error('Unexpected account fixture network request');
} });
try {
  const binding = 'e'.repeat(43), flow = await accounts.begin(binding), callback = new URL(process.env.VIRAL_HIT_GOOGLE_REDIRECT_URI!);
  callback.search = new URLSearchParams({ state: new URL(flow.authorizationUrl).searchParams.get('state')!, code: 'fixture-code', iss: 'https://accounts.google.com' }).toString();
  await accounts.complete(callback, binding, AbortSignal.timeout(10000));
} finally { accounts.close(); }

// Actual local preparation: no timeline mutation until the browser accepts the edit.
const { pinSequenceInputs, createSequenceAdapter } = await import('../src/core/harness/sequence-adapter');
const sequenceProject = await createProject({ name: 'Editable sequence E2E fixture' });
const sequenceLedger = openHarness();
try {
  const source = createMaterializeAdapter({ download: async (_url, destination) => { await copyFile('public/logo.png', destination); }, probe: probeMedia });
  const definition = JSON.parse(await readFile('../../recipes/editable-image-story.json', 'utf8'));
  const sequence = compileRecipe(definition, { image: 'deferred', title: 'EDIT THIS TITLE', duration: 3 }, sequenceProject.id).nodes[0];
  sequence.dependsOn = ['source']; sequence.bindings = [{ target: '/assets/image/assetId', node: 'source', pointer: '/assetId' }];
  const run = sequenceLedger.enqueue(await pinSequenceInputs({ projectId: sequenceProject.id, nodes: [
    { id: 'source', operation: 'asset.materialize', version: 'fixture', input: { kind: 'image', url: 'https://example.invalid/sequence.png' } }, sequence,
  ] }), 'editable-fixture');
  for (let i = 0; i < 4; i++) await sequenceLedger.step(run, { 'asset.materialize': source, 'editor.sequence': createSequenceAdapter() });
  if (sequenceLedger.jobs(run).some(job => job.state !== 'succeeded')) throw Error('Editable sequence fixture did not prepare');
} finally { sequenceLedger.close(); }

// Test fixtures are not guaranteed to remain in the bounded recent-project listing.
const { seedScenes } = await import('./seed-e2e-scenes');
const sceneProject = await seedScenes();
await mkdir('../../research/evidence/browser-fixtures', { recursive: true });
await writeFile('../../research/evidence/browser-fixtures/projects.json', JSON.stringify(Object.fromEntries([project, mediaProject, takeProject, referenceProject, sequenceProject, sceneProject].map(item => [item.name, item.id]))));
