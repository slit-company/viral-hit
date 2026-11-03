import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const root = await mkdtemp(join(tmpdir(), 'vh-spending-'));
process.env.VIRAL_HIT_DATA_DIR = root;
for (const key of ['VIRAL_HIT_PROVIDERS_DIR', 'VIRAL_HIT_ADAPTERS_DIR', 'VIRAL_HIT_HARNESS_DB']) delete process.env[key];
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
const providers = join(root, 'providers'), folder = join(providers, 'priced');
await mkdir(folder, { recursive: true });
const pricing = { currency: 'USD', per: 'character', amount: 0.001, basis: 'list', source: 'https://example.com/pricing', checked: '2026-11-03' };
await writeFile(join(folder, 'provider.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'priced', label: 'Priced', scope: 'general', entry: 'provider.mjs', environment: [], models: [{ id: 'priced-voice', name: 'Priced voice', kind: 'audio', pricing }] }));
await writeFile(join(folder, 'provider.mjs'), `
function sound(){const b=Buffer.alloc(524);b.write('RIFF');b.writeUInt32LE(516,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(480,40);return {status:'succeeded',media:[{data:b,mimeType:'audio/wav'}]};}
export async function createGeneration({input}) { if (input.prompt === 'fail') throw Error('No credit left'); return sound(); }
`);
after(async () => { await rm(root, { recursive: true, force: true }); });
const { installGenerationProviders } = await import('../generation-providers/installed/install.server');
assert.deepEqual(installGenerationProviders(providers).problems, []);
const { createProject } = await import('@/core/projects/projects');
const { requestAssetGeneration } = await import('../generation-providers/asset-generation.server');
const { readSpending } = await import('./spending.server');

test('the ledger keeps each request\'s estimate and leaves failed generations out of the total', async () => {
  const project = await createProject({ name: 'Spending' });
  for (const prompt of ['Hello there', 'fail']) {
    const prepared = await requestAssetGeneration({ action: 'prepare', generation: { version: 2, projectId: project.id, mode: 'audio', modelId: 'priced-voice', prompt, references: [], parameters: {} } }, 'mcp');
    await requestAssetGeneration({ action: 'submit', generation: prepared.generation, generationIntentToken: prepared.generationIntentToken, expectedDigest: prepared.digest }, 'mcp').catch(() => undefined);
  }
  const spending = await readSpending({ days: 7 });
  assert.equal(spending.generations, 2);
  assert.equal(spending.failed, 1);
  assert.deepEqual(spending.total, { totals: [{ amount: 0.011, currency: 'USD', basis: 'list' }], unpriced: 0 });
  assert.deepEqual(spending.services.map(service => [service.label, service.generations, service.failed]), [['Priced', 2, 1]]);
  assert.deepEqual(spending.recent.map(row => [row.status, row.cost?.amount ?? null]).sort(), [['failed', 0.004], ['succeeded', 0.011]]);
});
