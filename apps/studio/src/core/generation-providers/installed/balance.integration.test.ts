import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'vh-provider-balance-'));
const providers = join(root, 'providers');
process.env.VIRAL_HIT_DATA_DIR = join(root, 'data');
process.env.VIRAL_HIT_PROVIDERS_DIR = providers;
after(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(providers, 'credit-fixture'), { recursive: true });
writeFileSync(join(providers, 'credit-fixture', 'provider.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'credit-fixture', label: 'Credit fixture', environment: ['VH_CREDIT_FIXTURE_KEY'], configurationDelivery: 'request', connectionTest: true, balanceCheck: true, models: [{ id: 'credit-fixture-image', name: 'Credit fixture image', kind: 'image', aspectRatios: ['1:1'] }] }));
// The module reads its answer from the test so one installed runtime can report several balances.
writeFileSync(join(providers, 'credit-fixture', 'provider.mjs'), `export async function createGeneration(){return {status:'failed',error:'not used'};}
export async function testConnection(){return {ok:true};}
export async function checkBalance({configuration}){const next=globalThis.__vhCreditFixture; if(next==='leak')throw Error('billing denied for '+configuration.VH_CREDIT_FIXTURE_KEY); return next;}`);

const { changeProviderCredentials, providerConfigurationView } = await import('./credentials.server');
const { installedConnectionRuntime } = await import('./install.server');
const { markCreditsAdded, providerBalances, refreshProviderBalance } = await import('./balance.server');
const { providerConnections } = await import('./connections.server');
const { assertServiceHasCredit } = await import('../credit-gate.server');
const fixture = (value: unknown) => { (globalThis as { __vhCreditFixture?: unknown }).__vhCreditFixture = value; };

test('balances are cached per service, refuse paid submissions at zero and never expose the key', async () => {
  const manifest = installedConnectionRuntime('credit-fixture')!.manifest;
  changeProviderCredentials(manifest, providerConfigurationView(manifest).revision, { VH_CREDIT_FIXTURE_KEY: 'fixture-secret-key-value' });
  fixture({ state: 'known', amount: 0, unit: 'USD' });
  assert.equal((await refreshProviderBalance('credit-fixture')).state, 'empty');
  const listed = (await providerConnections()).find(item => item.id === 'credit-fixture')!;
  assert.deepEqual(listed.credit, { state: 'empty', source: 'balance', reason: 'no credits left (0 USD)' });
  assert.equal(listed.canCheckBalance, true);
  await assert.rejects(assertServiceHasCredit('credit-fixture', 'Credit fixture'), /Credit fixture has no credits left \(0 USD\)/);
  fixture({ state: 'known', amount: 7.25, unit: 'USD' });
  assert.equal((await providerBalances({ wait: true, maxAgeMs: 0 })).get('credit-fixture')?.amount, 7.25);
  await assertServiceHasCredit('credit-fixture', 'Credit fixture');
  fixture('leak');
  const failed = await refreshProviderBalance('credit-fixture');
  assert.equal(failed.state, 'unknown');
  assert.doesNotMatch(JSON.stringify(failed), /fixture-secret-key-value/);
  await assertServiceHasCredit('credit-fixture', 'Credit fixture');
  fixture({ state: 'known', amount: 'lots', unit: 'USD' });
  assert.equal((await refreshProviderBalance('credit-fixture')).state, 'unknown', 'malformed answers are not trusted');
  const marked = await markCreditsAdded('credit-fixture');
  assert.equal(marked.providerId, 'credit-fixture');
  assert.equal((await providerConnections()).find(item => item.id === 'credit-fixture')?.balance, undefined, 'credits added drops the cached balance');
});
