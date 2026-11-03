import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'vh-identities-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(() => rm(directory, { recursive: true, force: true }));
const { changeCharacters } = await import('./service.server');
const { trainCharacterIdentity, checkCharacterIdentity } = await import('./identity.server');
type Saved = { id: string; version: number; providerIdentities: Array<Record<string, string>> };

const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const image = (name: string, color: string) => { const file = join(directory, name); execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=' + color + ':s=64x64', '-frames:v', '1', file]); return file; };

/** Stands in for an installed service: records what it was sent and answers like Higgsfield's Soul ID API. */
function service() {
  const sent: Array<{ name: string; version: string; images: number }> = [];
  let status: 'training' | 'ready' | 'failed' = 'training';
  const runtime = {
    manifest: { identityTraining: { family: 'higgsfield-soul', label: 'Soul ID', versions: [{ value: 'v2', label: 'Soul 2' }, { value: 'cinema', label: 'Soul Cinema' }], maxImages: 2 } },
    createIdentity: async (request: { name: string; version: string; images: { bytes: Uint8Array }[] }) => { sent.push({ name: request.name, version: request.version, images: request.images.length }); return { referenceId: 'soul-' + request.version + '-' + sent.length, status: 'training' as const }; },
    checkIdentity: async (referenceId: string) => ({ referenceId, status, ...(status === 'failed' ? { error: 'No face found' } : {}) }),
  } as never;
  return { runtime, sent, finish: (next: typeof status) => { status = next; } };
}

test('a character trains a service identity from its images, keeps one per version and records how training ends', async () => {
  const pasted = { provider: 'higgsfield-soul', referenceId: '11111111-2222-4333-8444-555555555555' };
  const created = await changeCharacters({ action: 'create', profile: { name: 'Mina', kind: 'person', description: 'A courier in a lime rain jacket.', invariants: [], forbidden: [], providerIdentities: [pasted] },
    references: [{ path: image('side.png', 'teal'), role: 'angle' }, { path: image('front.png', 'orange'), role: 'canonical' }, { path: image('smile.png', 'pink'), role: 'expression' }] }) as Saved;
  const fake = service(), runtimeFor = () => fake.runtime;
  await assert.rejects(trainCharacterIdentity({ id: created.id, expectedVersion: created.version + 1, providerId: 'higgsfield', version: 'v2' }, runtimeFor), /changed since you opened it/);
  await assert.rejects(trainCharacterIdentity({ id: created.id, expectedVersion: created.version, providerId: 'higgsfield', version: 'v2' }, () => undefined), /does not train/);
  const first = await trainCharacterIdentity({ id: created.id, expectedVersion: created.version, providerId: 'higgsfield', version: 'v2' }, runtimeFor);
  // No more images than the service takes.
  assert.deepEqual(fake.sent.map(item => [item.name, item.version, item.images]), [['Mina', 'v2', 2]]);
  assert.deepEqual(first.identity, { provider: 'higgsfield-soul', referenceId: 'soul-v2-1', label: 'Soul ID · Soul 2', providerId: 'higgsfield', version: 'v2', status: 'training' });
  assert.equal(first.character.version, created.version + 1);
  // Retraining the same version replaces it; another version is kept beside it; the pasted ID stays.
  const again = await trainCharacterIdentity({ id: created.id, expectedVersion: first.character.version, providerId: 'higgsfield', version: 'v2' }, runtimeFor);
  const cinema = await trainCharacterIdentity({ id: created.id, expectedVersion: again.character.version, providerId: 'higgsfield', version: 'cinema' }, runtimeFor);
  assert.deepEqual(cinema.character.providerIdentities.map(item => item.referenceId), [pasted.referenceId, 'soul-v2-2', 'soul-cinema-3']);
  const unchanged = await checkCharacterIdentity({ id: created.id, referenceId: 'soul-v2-2' }, runtimeFor);
  assert.equal(unchanged.character.version, cinema.character.version, 'nothing new, nothing written');
  fake.finish('ready');
  const ready = await checkCharacterIdentity({ id: created.id, referenceId: 'soul-v2-2' }, runtimeFor);
  assert.deepEqual([ready.identity.status, ready.character.version], ['ready', cinema.character.version + 1]);
  fake.finish('failed');
  const failed = await checkCharacterIdentity({ id: created.id, referenceId: 'soul-cinema-3' }, runtimeFor);
  assert.deepEqual([failed.identity.status, failed.identity.error], ['failed', 'No face found']);
  assert.equal((await checkCharacterIdentity({ id: created.id, referenceId: pasted.referenceId }, runtimeFor)).identity.status, undefined, 'a pasted ID is not checked');
});
