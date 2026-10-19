// Actual ima2 3.26.3 HTTP routes + Viral Hit harness/materializer/timeline; AI output is a fixture.
import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Adapter } from '../src/core/harness/durable';

const studio = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(studio);
const [runtime, destination] = process.argv.slice(2);
if (!runtime || !destination || !isAbsolute(runtime) || !isAbsolute(destination)) throw Error('Pass absolute ima2 package root and evidence directory');
await mkdir(destination, { recursive: true });
const evidence = await mkdtemp(join(destination, 'run-'));
await mkdir(join(evidence, 'home'), { recursive: true });
const extension = resolve(studio, '../../extensions/ima2');
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: extension, stdio: 'pipe' });
const child = fork(join(extension, 'test/runtime-fixture.mjs'), [runtime], { execArgv: [],
  env: { PATH: process.env.PATH, HOME: join(evidence, 'home'), IMA2_CONFIG_DIR: join(evidence, 'ima2'),
    IMA2_GENERATED_DIR: join(evidence, 'generated'), VH_IMA2_TEST_FIXTURE: '1' }, silent: true });
process.on('exit', () => { if (child.exitCode === null) child.kill(); });
let runtimeLogs = '';
child.stdout?.on('data', chunk => { runtimeLogs += chunk; });
child.stderr?.on('data', chunk => { runtimeLogs += chunk; });
const startup = await Promise.race([
  once(child, 'message', { signal: AbortSignal.timeout(30000) }).then(([message]) => message as { url: string }),
  once(child, 'exit').then(() => { throw Error(`ima2 fixture exited: ${runtimeLogs}`); }),
]);
process.env.VIRAL_HIT_DATA_DIR = join(evidence, 'data');
process.env.VIRAL_HIT_IMA2_URL = startup.url;
delete process.env.VIRAL_HIT_IMA2_TOKEN;
process.env.VIRAL_HIT_ADAPTERS_DIR = join(extension, 'dist/adapters');
await mkdir(process.env.VIRAL_HIT_DATA_DIR, { recursive: true });
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { cwd: studio, env: process.env, stdio: 'pipe' });
const { openHarness } = await import('../src/core/harness/store');
const { readExternalCatalog, pinExternalAdapters } = await import('../src/core/harness/external-catalog');
const { pinExternalMediaInputs } = await import('../src/core/harness/external-media-inputs');
const { createExternalAdapter } = await import('../src/core/harness/external-adapters');
const { createMaterializeAdapter } = await import('../src/core/harness/materialize');
const { compileRecipe } = await import('../src/core/harness/recipes');
const { createProject } = await import('../src/core/projects/projects');
const { attachMaterializedJob } = await import('../src/core/harness/attach-asset');
const { loadProjectTimeline } = await import('../src/core/editor/timeline-state');
const { readBinaryReceipt } = await import('../src/core/harness/binary-receipts');
const entries = readExternalCatalog(process.env.VIRAL_HIT_ADAPTERS_DIR);
const adapters: Record<string, Adapter> = { ...Object.fromEntries(entries.map(entry => [entry.descriptor.operation, createExternalAdapter(entry)])), 'asset.materialize': createMaterializeAdapter() };
const submit = adapters['ext.ima2-image'].submit;
const reconcile = adapters['ext.ima2-image'].reconcile!;
let recoveries = 0;
adapters['ext.ima2-image'].reconcile = async (input, context) => {
  recoveries++;
  return reconcile(input, context);
};
adapters['ext.ima2-image'].submit = async (input, context) => {
  await submit(input, context);
  throw Error('Test interruption after ima2 accepted the original job');
};
const project = await createProject({ name: 'ima2 integration fixture' });
const h = openHarness();
const runs = [];
let source = '';
try {
  for (const name of ['ima2-image', 'ima2-reference']) {
    const recipe = JSON.parse(await readFile(join(extension, 'recipes', `${name}.json`), 'utf8'));
    const values = { provider: 'api', model: 'gpt-5.4', prompt: 'An orange kite with detailed lighting and composition. '.repeat(20), ...(source ? { source } : {}) };
    const plan = await pinExternalMediaInputs(pinExternalAdapters(compileRecipe(recipe, values, project.id), entries), entries);
    const run = h.enqueue(plan, name);
    for (let i = 0; i < 20; i++) {
      await h.step(run, adapters);
      if (h.jobs(run).every(job => job.state === 'succeeded')) break;
      if (h.jobs(run).some(job => ['failed', 'uncertain'].includes(job.state))) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const jobs = h.jobs(run);
    assert.deepEqual(jobs.map(job => job.state), ['succeeded', 'succeeded'], JSON.stringify(jobs.map(job => ({ state: job.state, error: job.error }))));
    if (name === 'ima2-image') {
      assert.ok(recoveries >= 1, 'ambiguous submission must recover by observation');
      assert.equal(jobs[0].attempts, 1, 'recovery must not make another submission attempt');
    }
    const result = JSON.parse(jobs[1].output_json!);
    const receipt = await readBinaryReceipt({ projectId: project.id, jobId: jobs[0].id }, AbortSignal.timeout(5000));
    assert.ok(receipt); assert.equal(receipt.receipt.model, 'ima2/api/gpt-5.4'); assert.equal(receipt.receipt.creditsUsed, null);
    const timeline = await loadProjectTimeline(project.id);
    assert.equal((await attachMaterializedJob(h, project.id, run, jobs[1].id, timeline?.version ?? 0)).ok, true);
    // Exact original input identity is pinned for the second recipe.
    if (source) assert.equal((plan.nodes[0].input as { assetPins: { source: { assetId: string } } }).assetPins.source.assetId, source);
    source = result.assetId;
    const recovered = await adapters[`ext.${name}`].reconcile!(JSON.parse(jobs[0].execution_input_json!), { key: jobs[0].idempotency_key, signal: AbortSignal.timeout(10000) });
    assert.equal(recovered?.id, jobs[0].provider_id);
    runs.push({ name, runId: run, assetId: source, providerJobId: recovered.id, receipt: receipt.receipt });
  }
  const stats = once(child, 'message'); child.send('stats');
  const [counts] = await stats;
  assert.equal(counts.paidCalls, 2); assert.equal(counts.referencedCalls, 1);
  const timeline = await loadProjectTimeline(project.id); assert.ok(timeline);
  assert.equal(timeline.document.tracks.flatMap(track => track.clips).length, 2);
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ validation: 'Actual ima2 HTTP/storage; synthetic AI provider output, no paid generation', counts, runs, timelineRevision: timeline.version }, null, 2));
  console.log(`Both recipes traversed actual ima2 routes, receipts, project assets and timeline. Evidence: ${evidence}`);
} finally {
  h.close(); await writeFile(join(evidence, 'runtime.log'), runtimeLogs);
  const stopped = once(child, 'exit'); child.send('stop'); await stopped;
}
