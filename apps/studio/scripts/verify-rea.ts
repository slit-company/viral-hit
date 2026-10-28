// Real, separately installed REA against operator-selected targets; isolated studio data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const studio = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(studio);
const [configurationFile, destination, ...targetIds] = process.argv.slice(2);
if (!configurationFile || !destination || !isAbsolute(configurationFile) || !isAbsolute(destination) || !targetIds.length) throw Error('Pass absolute configuration JSON, evidence directory and target IDs');
const settings = JSON.parse(await readFile(configurationFile, 'utf8'));
for (const key of ['NODE', 'CLI', 'CLI_SHA256', 'TARGETS']) {
  const name = 'VIRAL_HIT_REA_' + key;
  if (typeof settings[name] !== 'string') throw Error('Missing ' + name);
  process.env[name] = settings[name];
}
await mkdir(destination, { recursive: true });
const evidence = await mkdtemp(join(destination, 'verification-'));
process.env.VIRAL_HIT_DATA_DIR = join(evidence, 'data');
process.env.VIRAL_HIT_REA_EVIDENCE_DIR = join(evidence, 'private');
delete process.env.VIRAL_HIT_HARNESS_DB;
delete process.env.VIRAL_HIT_ADAPTERS_DIR;
await mkdir(process.env.VIRAL_HIT_DATA_DIR, { recursive: true });
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { cwd: studio, env: process.env, stdio: 'pipe' });
const extension = resolve(studio, '../../extensions/rea/dist');
const json = async (name: string) => JSON.parse(await readFile(join(extension, name), 'utf8'));
const { inspectRuntimePackage } = await import('../src/core/runtime-packages/service.server');
assert.deepEqual(inspectRuntimePackage(await json('rea.runtime.json')).blocking, []);
process.env.VIRAL_HIT_ADAPTERS_DIR = join(extension, 'adapters');
const { inspectPack, installPack } = await import('../src/core/harness/recipe-pack-library');
const pack = await json('rea.pack.json'), review = await inspectPack(pack);
await installPack(pack, review.pack.digest);
const { inspectSkillFile, changeSkillLibrary } = await import('../src/core/skills/library.server');
const skill = await json('rea.skill.json'), skillReview = await inspectSkillFile(skill);
assert.deepEqual(skillReview.blocking, []);
await changeSkillLibrary({ action: 'install', file: skill, expectedDigest: skillReview.digest });
const { createProject } = await import('../src/core/projects/projects');
const { prepareRecipePlan } = await import('../src/core/harness/recipe-plan');
const { pinRuntimePlan } = await import('../src/core/harness/runtime-plan');
const { externalCatalog } = await import('../src/core/harness/external-catalog');
const { createExternalAdapters } = await import('../src/core/harness/external-adapters');
const { openHarness } = await import('../src/core/harness/store');
const { readInspectionReport } = await import('../src/core/inspection/report');
const project = await createProject({ name: 'REA app inspection verification' });
const targets = JSON.parse(await readFile(process.env.VIRAL_HIT_REA_TARGETS!, 'utf8')).targets;
assert.equal(externalCatalog().filter(entry => entry.descriptor.operation === 'ext.rea-inspect').length, 1);
const h = openHarness(), runs = [];
try {
  for (const targetId of targetIds) {
    const target = targets.find((item: { id: string }) => item.id === targetId);
    assert.ok(target, 'Registered target required');
    const plan = await pinRuntimePlan(await prepareRecipePlan('rea-' + target.kind, {
      target: targetId, question: 'Which visible entry points, modules and API candidates describe this app, and what remains unverified?',
    }, project.id));
    const runId = h.enqueue(plan, randomUUID());
    for (let step = 0; step < 3; step++) {
      await h.step(runId, createExternalAdapters());
      if (h.jobs(runId).every(job => ['succeeded', 'failed', 'uncertain', 'canceled'].includes(job.state))) break;
    }
    const [job] = h.jobs(runId);
    assert.equal(job.state, 'succeeded', job.error ?? 'REA job did not complete');
    const report = readInspectionReport(job.output_json);
    assert.ok(report); assert.equal(report.projectId, project.id); assert.equal(report.targetId, targetId);
    for (const item of report.evidence) {
      const raw: Buffer = await readFile(join(process.env.VIRAL_HIT_REA_EVIDENCE_DIR!, report.receiptId, item.file));
      assert.equal(createHash('sha256').update(raw).digest('hex'), item.sha256);
      assert.equal(JSON.parse(raw.toString()).evidence_id, item.id);
    }
    runs.push({ targetId, runId, jobId: job.id, status: report.status, findings: report.facts.length, receiptId: report.receiptId });
    console.log(JSON.stringify(runs.at(-1)));
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VIRAL_HIT_REA_') || ['VIRAL_HIT_DATA_DIR', 'VIRAL_HIT_ADAPTERS_DIR'].includes(key)));
  await writeFile(join(evidence, 'preview-env.json'), JSON.stringify(env, null, 2), { mode: 0o600 });
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ validation: 'Real REA CLI and existing Viral Hit harness; target behavior beyond captured evidence remains unverified', projectId: project.id, runs }, null, 2));
  console.log('Evidence directory: ' + evidence);
} finally { h.close(); }
