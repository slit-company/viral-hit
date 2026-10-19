import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DurableHarness } from './durable';
import { compileRecipe } from './recipes';
import { readExternalCatalog, pinExternalAdapters } from './external-catalog';
import { createExternalAdapter } from './external-adapters';
import { readBinaryReceipt } from './binary-receipts';

const directory = await mkdtemp(join(tmpdir(), 'vh-external-integration-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { createProject } = await import('../projects/projects');
const { createMaterializeAdapter } = await import('./materialize');
const { attachMaterializedJob } = await import('./attach-asset');
const recipe = JSON.parse(await readFile('../../examples/adapter-recipes/procedural-tone.json', 'utf8'));
const entry = readExternalCatalog(resolve('../../examples/adapters/tone'))[0];

test('independently installed procedural adapter produces actual WAV bytes and a project timeline asset', async () => {
  const project = await createProject({ name: 'External procedural audio' });
  const h = new DurableHarness(':memory:');
  try {
    const run = h.enqueue(pinExternalAdapters(compileRecipe(recipe, { frequency: 523.25, duration: 1.25 }, project.id), [entry]), 'tone');
    const adapters = { 'ext.example-tone': createExternalAdapter(entry), 'asset.materialize': createMaterializeAdapter() };
    for (let i = 0; i < 4; i++) await h.step(run, adapters);
    const jobs = h.jobs(run); assert.deepEqual(jobs.map(job => job.state), ['succeeded', 'succeeded']);
    const saved = await readBinaryReceipt({ projectId: project.id, jobId: jobs[0].id }, AbortSignal.timeout(2000));
    assert.ok(saved); assert.equal(saved.receipt.provider, 'external-adapter'); assert.equal(saved.receipt.adapterDigest, entry.digest);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', saved.file], { encoding: 'utf8' }));
    assert.equal(probe.streams[0].codec_name, 'pcm_s16le'); assert.equal(Number(probe.format.duration), 1.25);
    const bytes = await readFile(saved.file); assert.equal(bytes.length, 60044);
    const result = await attachMaterializedJob(h, project.id, run, jobs[1].id, 0);
    assert.equal(result.ok, true);
  } finally { h.close(); }
});

test('a lost adapter poll result reuses published binary bytes after worker restart', async () => {
  const project = await createProject({ name: 'External adapter restart' });
  const modified = (await readFile('../../examples/adapters/tone/tone.mjs', 'utf8'))
    .replace('const rate =', "process.env.VH_TONE_TEST_CALLS = String(Number(process.env.VH_TONE_TEST_CALLS || 0) + 1); const rate =")
    .replace("return { state: 'succeeded', output };", "throw Error('interrupted after binary publish');");
  const descriptor = { ...entry.descriptor, sha256: createHash('sha256').update(modified).digest('hex') };
  const path = await mkdtemp(join(directory, 'restart-')); await writeFile(join(path, 'tone.mjs'), modified); await writeFile(join(path, 'tone.json'), JSON.stringify(descriptor));
  const installed = readExternalCatalog(path)[0]; let now = 10000;
  let h = new DurableHarness(join(directory, 'jobs.sqlite'), () => now);
  try {
    const plan = pinExternalAdapters(compileRecipe(recipe, { frequency: 220, duration: 0.5 }, project.id), [installed]); plan.nodes = plan.nodes.slice(0, 1);
    const run = h.enqueue(plan, 'restart');
    await h.step(run, { 'ext.example-tone': createExternalAdapter(installed) });
    await h.step(run, { 'ext.example-tone': createExternalAdapter(installed) });
    assert.equal(h.jobs(run)[0].state, 'running'); assert.equal(process.env.VH_TONE_TEST_CALLS, '1');
    h.close(); now += 6000; h = new DurableHarness(join(directory, 'jobs.sqlite'), () => now);
    await h.step(run, { 'ext.example-tone': createExternalAdapter(readExternalCatalog(path)[0]) });
    assert.equal(h.jobs(run)[0].state, 'succeeded'); assert.equal(process.env.VH_TONE_TEST_CALLS, '1');
    const output = JSON.parse(h.jobs(run)[0].output_json!); assert.equal(output.sizeBytes, 24044);
  } finally { h.close(); delete process.env.VH_TONE_TEST_CALLS; }
});
