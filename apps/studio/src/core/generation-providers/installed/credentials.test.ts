import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { changeProviderCredentials, readProviderCredentials, providerConfigurationView, resolveProviderConfiguration } from './credentials.server';
import { providerManifestSchema } from './manifest';
import { providerRuntimeDigest } from './task-pin.server';
import { InstalledProviderRuntime } from './runtime.server';
import type { EffectRecord } from '@/core/adapters/base-adapter';
const root = mkdtempSync(join(tmpdir(), 'vh-provider-credentials-'));
process.env.VIRAL_HIT_DATA_DIR = root;
after(() => { delete process.env.VH_TEST_CONNECT_KEY; rmSync(root, { recursive: true, force: true }); });
const manifest = providerManifestSchema.parse({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'test-connect', label: 'Test connection', environment: ['VH_TEST_CONNECT_KEY'], configurationDelivery: 'request', connectionTest: true, models: [{ id: 'connected-image', name: 'Connected image', kind: 'image', aspectRatios: ['1:1'] }] });

test('credentials are encrypted, revision checked, redacted and environment overrides do not mutate process.env', () => {
  const value = 'not-a-real-provider-key';
  const saved = changeProviderCredentials(manifest, 'none', { VH_TEST_CONNECT_KEY: value });
  assert.equal(process.env.VH_TEST_CONNECT_KEY, undefined);
  assert.equal(resolveProviderConfiguration(manifest).VH_TEST_CONNECT_KEY, value);
  const file = join(root, 'provider-credentials/test-connect.sealed');
  assert.equal(readFileSync(file).includes(Buffer.from(value)), false); assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(providerConfigurationView(manifest)).includes(value), false);
  assert.throws(() => changeProviderCredentials(manifest, 'none', { VH_TEST_CONNECT_KEY: 'stale' }), /changed/);
  assert.throws(() => changeProviderCredentials(manifest, saved.revision, { UNKNOWN_KEY: 'bad' }), /Unknown/);
  process.env.VH_TEST_CONNECT_KEY = 'environment-value';
  assert.equal(resolveProviderConfiguration(manifest).VH_TEST_CONNECT_KEY, 'environment-value');
  assert.throws(() => changeProviderCredentials(manifest, saved.revision, { VH_TEST_CONNECT_KEY: 'replace-env' }), /server environment/);
  delete process.env.VH_TEST_CONNECT_KEY;
});

test('requests receive only declared configuration; changing credentials fences polling and restoration resumes', async () => {
  const source = `export async function createGeneration({configuration,requestKey}) { if(configuration.VH_TEST_CONNECT_KEY!=='not-a-real-provider-key'||requestKey!=='durable-id')throw Error('Missing configuration/identity'); return {status:'processing',taskId:'remote-1'}; } export async function checkStatus(){return {status:'processing',taskId:'remote-1'};} export async function testConnection({configuration}){throw Error('upstream echoed '+configuration.VH_TEST_CONNECT_KEY);}`;
  const runtime = new InstalledProviderRuntime(manifest, source, true), effect = { linkName: 'connected-image' } as EffectRecord;
  const returnedError = new InstalledProviderRuntime(manifest, `export async function createGeneration({configuration}){return {status:'failed',error:configuration.VH_TEST_CONNECT_KEY};}`);
  assert.equal((await returnedError.call('createGeneration', effect, {input:{}})).error, '[redacted]');
  const first = providerRuntimeDigest(manifest, source);
  const created = await runtime.call('createGeneration', effect, { input: {}, requestKey: 'durable-id' });
  const taskId = (created.output as { taskId: string }).taskId;
  await assert.rejects(runtime.testConnection(), error => error instanceof Error && !error.message.includes('not-a-real-provider-key') && error.message.includes('[redacted]'));
  changeProviderCredentials(manifest, providerConfigurationView(manifest).revision, { VH_TEST_CONNECT_KEY: 'replacement' });
  assert.notEqual(providerRuntimeDigest(manifest, source), first);
  await assert.rejects(runtime.call('checkStatus', effect, { taskId }), /configuration changed/);
  changeProviderCredentials(manifest, providerConfigurationView(manifest).revision, { VH_TEST_CONNECT_KEY: 'not-a-real-provider-key' });
  assert.equal(providerRuntimeDigest(manifest, source), first);
  assert.equal((await runtime.call('checkStatus', effect, { taskId })).status, 'processing');
});

test('tampered ciphertext or a missing key fails closed; removing a key does not expose it', () => {
  const directory = join(root, 'provider-credentials'), file = join(directory, 'test-connect.sealed'), original = readFileSync(file);
  const corrupt = Buffer.from(original); corrupt[29] ^= 1; writeFileSync(file, corrupt);
  assert.throws(() => readProviderCredentials(manifest.id), /unavailable/); writeFileSync(file, original);
  renameSync(join(directory, 'workspace.key'), join(directory, 'workspace.backup'));
  assert.throws(() => readProviderCredentials(manifest.id), /unavailable/);
  renameSync(join(directory, 'workspace.backup'), join(directory, 'workspace.key'));
  const removed = changeProviderCredentials(manifest, providerConfigurationView(manifest).revision, { VH_TEST_CONNECT_KEY: null });
  assert.equal(removed.fields[0].source, 'missing'); assert.equal(resolveProviderConfiguration(manifest).VH_TEST_CONNECT_KEY, '');
});

test('oversized settings fail before replacing the encrypted credential file', () => {
  const manifestWithManyKeys = { ...manifest, id: 'many-keys', environment: Array.from({ length: 10 }, (_, i) => 'KEY_' + i) };
  assert.throws(() => changeProviderCredentials(manifestWithManyKeys, 'none', Object.fromEntries(manifestWithManyKeys.environment.map(name => [name, 'x'.repeat(8192)]))), /storage limit/);
  assert.equal(providerConfigurationView(manifestWithManyKeys).revision, 'none');
});
