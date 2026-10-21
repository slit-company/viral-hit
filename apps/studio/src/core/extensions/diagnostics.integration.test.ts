import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

const directory = await mkdtemp(join(tmpdir(), 'viral-hit-extension-status-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
process.env.VIRAL_HIT_PROVIDERS_DIR = join(directory, 'providers');
process.env.VIRAL_HIT_ADAPTERS_DIR = join(directory, 'adapters');
process.env.VIRAL_HIT_PUBLISHING_CONNECTORS_DIR = join(directory, 'publishing');
process.env.VIRAL_HIT_SKILLS_DIR = join(directory, 'skills');
delete process.env.VIRAL_HIT_TEST_PROVIDER_KEY;
const sentinel = 'private-setting-value-must-not-leak', marker = join(directory, 'executed.txt');
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(() => rm(directory, { recursive: true, force: true }));
const provider = join(process.env.VIRAL_HIT_PROVIDERS_DIR, 'protected-images');
await cp('../../examples/providers/procedural-images', provider, { recursive: true });
const manifestFile = join(provider, 'provider.json'), moduleFile = join(provider, 'provider.mjs');
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
manifest.id = 'protected-images'; manifest.label = 'Protected images'; manifest.scope = 'specialized';
manifest.environment = ['VIRAL_HIT_TEST_PROVIDER_KEY'];
manifest.models = [{ ...manifest.models[0], id: 'protected-gradient', name: 'Protected gradient' }];
await writeFile(manifestFile, JSON.stringify(manifest));
await writeFile(moduleFile, 'import { writeFileSync } from "node:fs"; writeFileSync(' + JSON.stringify(marker) + ', "ran");\n' + await readFile(moduleFile, 'utf8'));
for (const [folder, file] of [
  [join(process.env.VIRAL_HIT_PROVIDERS_DIR, 'broken'), 'provider.json'],
  [process.env.VIRAL_HIT_ADAPTERS_DIR, 'broken.json'],
  [join(process.env.VIRAL_HIT_PUBLISHING_CONNECTORS_DIR, 'ext.broken'), 'connector.json'],
  [join(process.env.VIRAL_HIT_SKILLS_DIR, 'broken'), 'skill.json'],
]) {
  await mkdir(folder, { recursive: true }); await writeFile(join(folder, file), '{ "private": "' + sentinel);
}
const { extensionDiagnostics } = await import('./diagnostics.server');
const { getGenerationModelDescriptor } = await import('../generation-providers/model-catalog');

test('diagnostics preserve healthy entries and isolate malformed catalogs without executing code or returning raw errors', async () => {
  const result = await extensionDiagnostics();
  assert.equal(result.groups.length, 4);
  const providers = result.groups.find(group => group.kind === 'providers')!;
  assert.equal(providers.items[0].id, 'protected-images');
  assert.equal(providers.items[0].scope, 'specialized');
  assert.equal(providers.items[0].state, 'needs-setup');
  assert.deepEqual(providers.items[0].configuration, [{ name: 'VIRAL_HIT_TEST_PROVIDER_KEY', present: false }]);
  assert.equal(providers.sourceChanged, false);
  assert.ok(result.groups.every(group => group.problems.length > 0));
  assert.ok(result.groups.find(group => group.kind === 'skills')!.items.some(item => item.source === 'official'));
  assert.equal(existsSync(marker), false);
  assert.equal(getGenerationModelDescriptor('protected-gradient')?.available, false);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(JSON.stringify(result).includes(directory), false);
});

test('missing provider settings block submission before upload authorization, generation records or module import', async () => {
  const { createProject } = await import('../projects/projects');
  const { submitAssetFirstGeneration } = await import('../generation-providers/submit');
  const project = await createProject({ name: 'Protected provider test' });
  const generation = { version: 2, projectId: project.id, modelId: 'protected-gradient', mode: 'image', prompt: 'A gradient', references: [], parameters: { aspect_ratio: '16:9' } };
  await assert.rejects(submitAssetFirstGeneration({ generation, origin: 'mcp' }), /Configure VIRAL_HIT_TEST_PROVIDER_KEY/);
  const db = new DatabaseSync(join(directory, 'local.db'), { readOnly: true });
  try {
    for (const table of ['generation_upload_intent', 'generation_history', 'asset']) {
      assert.equal(db.prepare('SELECT count(*) AS count FROM ' + table).get()?.count, 0, table);
    }
  } finally { db.close(); }
  assert.equal(existsSync(marker), false);
  process.env.VIRAL_HIT_TEST_PROVIDER_KEY = sentinel;
  const diagnostics = await extensionDiagnostics();
  assert.equal(diagnostics.groups[0].items[0].state, 'loaded');
  assert.deepEqual(diagnostics.groups[0].items[0].configuration, [{ name: 'VIRAL_HIT_TEST_PROVIDER_KEY', present: true }]);
  assert.equal(JSON.stringify(diagnostics).includes(sentinel), false);
  assert.equal(getGenerationModelDescriptor('protected-gradient')?.available, true);
  assert.equal(existsSync(marker), false);
  const result = await submitAssetFirstGeneration({ generation, origin: 'mcp' });
  assert.equal(result.body.status, 'succeeded', JSON.stringify(result.body));
  assert.equal(existsSync(marker), true);
  delete process.env.VIRAL_HIT_TEST_PROVIDER_KEY;
  assert.equal(getGenerationModelDescriptor('protected-gradient')?.available, false);
});

test('refresh detects changed provider files but retains the loaded snapshot until restart', async () => {
  const before = await extensionDiagnostics();
  assert.equal(before.groups[0].sourceChanged, false);
  manifest.label = 'Replacement name';
  await writeFile(manifestFile, JSON.stringify(manifest));
  const after = await extensionDiagnostics();
  assert.equal(after.groups[0].sourceChanged, true);
  assert.equal(after.groups[0].items[0].label, 'Protected images');
  assert.equal(getGenerationModelDescriptor('protected-gradient')?.name, 'Protected gradient');
});

test('a fresh CLI process uses the same diagnostic projection without importing provider modules', async () => {
  await rm(marker, { force: true });
  const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/extensions.ts'], { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const status = JSON.parse(output);
  assert.equal(status.groups[0].items[0].label, 'Replacement name');
  assert.equal(status.groups[0].sourceChanged, false);
  assert.equal(status.groups[0].items[0].state, 'needs-setup');
  assert.equal(status.groups.length, 4);
  assert.equal(output.includes(sentinel), false);
  assert.equal(output.includes(directory), false);
  assert.equal(existsSync(marker), false);
});
