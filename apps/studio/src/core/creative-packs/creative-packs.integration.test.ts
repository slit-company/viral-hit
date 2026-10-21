import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, open, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { after, test } from 'node:test';
import type { CreativePackBuild, CreativePackInspection, CreativePackResult } from './contract';

const root = await mkdtemp(join(tmpdir(), 'vh-creative-pack-'));
process.env.VIRAL_HIT_DATA_DIR = join(root, 'source');
process.env.VIRAL_HIT_SKILLS_DIR = resolve('../../examples/skills');
const { createCharacter, changeCharacterLibrary } = await import('../characters/library.server');
const { readCharacters, referencePath } = await import('../characters/storage.server');
const { getSkillRegistry } = await import('../skills/library.server');
const { readInstalledRecipes } = await import('../harness/recipe-storage');
const { changeCreativePacks } = await import('./service.server');
const { writeCreativePack, withCreativePack } = await import('./file.server');
const { composeCreativePack } = await import('./manifest.server');
const { scanTar, writeTar } = await import('../projects/bundles/tar.server');
const { uploadPack, downloadPack } = await import('../../routes/api/app/creative-packs/-http.server');
const image = join(root, 'host.png');
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xebb83f:s=80x80:d=1', '-frames:v', '1', image]);
const character = await createCharacter({ id: 'kit-host', profile: { name: 'Kit host', kind: 'mascot', description: 'A yellow square host', invariants: ['Keep the square silhouette'], forbidden: ['No text'], providerIdentities: [] } }, [{ path: image, role: 'canonical', note: 'Front reference' }]);
const build: CreativePackBuild = { id: 'story-kit', title: 'Story starter', description: 'A host, shot planning and an editable workflow.', version: '1.0.0', author: 'Studio', license: 'Apache-2.0', scope: 'specialized', useCases: ['short-stories'], recipeIds: ['open-frame'], skillIds: ['product-ad-shots', 'consistent-characters'], characterIds: ['kit-host'] };
const path = join(root, 'story.viralhit-pack.tar');
const built = await changeCreativePacks({ action: 'build', pack: build, path }) as { pack: { digest: string } };
const original = await withCreativePack(path, AbortSignal.timeout(30_000), async loaded => loaded.manifest);
after(async () => { await rm(root, { recursive: true, force: true }); });
function target(name: string) { process.env.VIRAL_HIT_DATA_DIR = join(root, name); delete process.env.VIRAL_HIT_SKILLS_DIR; }
const inspect = () => changeCreativePacks({ action: 'inspect', path }) as Promise<CreativePackInspection>;
const install = () => changeCreativePacks({ action: 'install', path, expectedDigest: built.pack.digest }) as Promise<CreativePackResult>;

test('a downloaded specialized pack stays byte-identical through review and installation without refetching its source', async () => {
  target('linked');
  const { fetchCreativePack } = await import('./source.server');
  const retained = join(root, 'retained.tar'); let downloads = 0;
  await fetchCreativePack('https://community.example.org/story.tar', retained, AbortSignal.timeout(30_000), async (_url, destination) => { downloads++; await copyFile(path, destination); });
  assert.deepEqual(await readFile(retained), await readFile(path));
  assert.equal(readCharacters().length, 0); assert.equal(readInstalledRecipes().length, 0);
  const review = await changeCreativePacks({ action: 'inspect', path: retained }) as CreativePackInspection;
  assert.equal(review.pack.scope, 'specialized'); assert.equal(review.characters[0].manifest.references[0].sha256, character.references[0].sha256);
  const result = await changeCreativePacks({ action: 'install', path: retained, expectedDigest: review.pack.digest }) as CreativePackResult;
  assert.equal(result.complete, true); assert.equal(downloads, 1);
  assert.deepEqual(await readFile(referencePath(character.references[0].sha256)), await readFile(image));
});

test('a mixed specialized pack moves exact images, instructions and recipes between installations and reuses identical contents', async () => {
  target('destination');
  const review = await inspect();
  assert.equal(review.pack.digest, built.pack.digest); assert.deepEqual(review.blocking, []);
  assert.equal(review.skills.find(skill => skill.file.manifest.id === 'consistent-characters')!.reused, true);
  assert.equal(review.characters[0].collision, 'none'); assert.equal(readCharacters().length, 0); assert.equal(readInstalledRecipes().length, 0);
  const result = await install(); assert.equal(result.complete, true, result.error);
  assert.deepEqual(readCharacters()[0].references, character.references);
  assert.deepEqual(await readFile(referencePath(character.references[0].sha256)), await readFile(image));
  assert.equal((await getSkillRegistry()).get('product-ad-shots')!.instructions, original.skills[0].instructions);
  assert.equal(readInstalledRecipes()[0].id, 'story-kit-open-frame');
  assert.deepEqual((await install()).items.map(item => item.state), ['reused', 'reused', 'reused', 'reused']);
  assert.equal(readCharacters().length, 1);
  await changeCharacterLibrary({ action: 'update', id: 'kit-host', expectedVersion: 1, profile: { description: 'A later local edit' } });
  const exported = join(root, 'snapshot.tar');
  await changeCreativePacks({ action: 'export', id: 'story-kit', path: exported });
  assert.deepEqual(await withCreativePack(exported, AbortSignal.timeout(30_000), async loaded => loaded.manifest), original);
  await assert.rejects(changeCreativePacks({ action: 'export', id: 'story-kit', path: exported }), /EEXIST/);
  assert.match((await inspect()).blocking.join(' '), /another character/);
});

test('stale reviews, changed images and missing members fail before any installation', async () => {
  target('invalid');
  await assert.rejects(changeCreativePacks({ action: 'install', path, expectedDigest: '0'.repeat(64) }), /changed after review/);
  const bytes = await readFile(path), corrupted = Buffer.from(bytes);
  const members = await scanTar(path), first = members.get('media/' + character.references[0].sha256)!;
  corrupted[first.offset + 40] ^= 1;
  const damaged = join(root, 'damaged.tar'); await writeFile(damaged, corrupted);
  await assert.rejects(changeCreativePacks({ action: 'install', path: damaged, expectedDigest: built.pack.digest }), /checksum/);
  const missing = join(root, 'missing.tar'), file = await open(missing, 'wx');
  await writeTar(file, Buffer.from(JSON.stringify(original)), [], AbortSignal.timeout(30_000)); await file.close();
  await assert.rejects(changeCreativePacks({ action: 'inspect', path: missing }), /missing or extra/);
  assert.equal(readInstalledRecipes().length, 0); assert.equal(readCharacters().length, 0);
  assert.equal((await getSkillRegistry()).get('product-ad-shots'), null);
});

test('an interrupted multi-library install reports its partial result and retry resumes without duplicate entries', async () => {
  target('partial');
  const broken = referencePath(character.references[0].sha256); await mkdir(broken, { recursive: true });
  const partial = await install(); assert.equal(partial.complete, false); assert.equal(partial.items.length, 3);
  assert.equal(readInstalledRecipes().length, 1); assert.equal(readCharacters().length, 0);
  await rm(broken, { recursive: true });
  const resumed = await install(); assert.equal(resumed.complete, true, resumed.error);
  assert.deepEqual(resumed.items.map(item => item.state), ['reused', 'reused', 'reused', 'installed']);
  assert.equal(readInstalledRecipes().length, 1); assert.equal(readCharacters().length, 1);
});

test('general skill-only packs and concurrent identical installs use the same format without partial character duplicates', async () => {
  target('general');
  const manifest = await composeCreativePack({ ...build, id: 'general-kit', scope: 'general', recipeIds: [], skillIds: ['consistent-characters'], characterIds: [] });
  const general = join(root, 'general.tar'), written = await writeCreativePack(manifest, general, AbortSignal.timeout(30_000));
  const result = await changeCreativePacks({ action: 'install', path: general, expectedDigest: written.pack.digest }) as CreativePackResult;
  assert.equal(result.complete, true); assert.equal(result.pack.scope, 'general'); assert.equal(result.items[0].state, 'reused');
  target('concurrent');
  const damaged = referencePath(character.references[0].sha256);
  await mkdir(join(process.env.VIRAL_HIT_DATA_DIR!, 'characters'), { recursive: true });
  await writeFile(damaged, Buffer.alloc((await readFile(image)).length));
  const results = await Promise.all([install(), install()]);
  assert.ok(results.every(result => result.complete), JSON.stringify(results)); assert.equal(readCharacters().length, 1); assert.equal(readInstalledRecipes().length, 1);
  assert.deepEqual(await readFile(damaged), await readFile(image));
});

test('browser file routes refuse paths and untrusted uploads and share exact reviewed installation', async () => {
  target('http');
  const bytes = new Uint8Array(await readFile(path));
  const request = (action: string, trusted = true) => new Request('http://localhost/api/app/creative-packs/file?action=' + action, { method: 'POST', headers: { 'content-type': 'application/x-tar', ...(trusted ? { 'x-viral-hit-workspace-request': '1' } : {}) }, body: bytes });
  assert.equal((await uploadPack(request('inspect', false))).status, 403);
  const inspected = await uploadPack(request('inspect')); assert.equal(inspected.status, 200);
  const review = await inspected.json() as CreativePackInspection;
  const accepted = await uploadPack(request('install&digest=' + review.pack.digest)); assert.equal(accepted.status, 200); assert.equal((await accepted.json()).complete, true);
  const badDownload = await downloadPack(new Request('http://localhost/api/app/creative-packs', { method: 'POST', headers: { 'content-type': 'application/json', 'x-viral-hit-workspace-request': '1' }, body: JSON.stringify({ action: 'export', id: 'story-kit', path: '/tmp/unwanted.tar' }) }));
  assert.equal(badDownload.status, 400);
});
