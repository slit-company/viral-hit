import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, execFile } from 'node:child_process';
import { createCharacter, changeCharacterLibrary } from '@/core/characters/library.server';
import { readCharacter, referencePath } from '@/core/characters/storage.server';
import { changeSkillLibrary, inspectSkillFile, getSkillRegistry } from '@/core/skills/library.server';
import { changeRecipeLibrary, inspectRecipe } from '@/core/harness/recipe-library';
import { readInstalledRecipes, readInstalledPacks } from '@/core/harness/recipe-storage';
import { prepareRecipePlan } from '@/core/harness/recipe-plan';
import { DurableHarness } from '@/core/harness/durable';
import { composeCreativePack, summarizeCreativePack } from './manifest.server';
import { writeCreativePack, withCreativePack } from './file.server';
import { changeCreativePacks } from './service.server';
import { readStoredCreativePack, readCreativePackState } from './storage.server';
import type { CreativePackInspection, CreativePackResult } from './contract';
import { uploadPack, downloadPack } from '@/routes/api/app/creative-packs/-http.server';

async function fixture(run: (context: Awaited<ReturnType<typeof prepare>>) => Promise<void>) {
  const keys = ['VIRAL_HIT_DATA_DIR', 'VIRAL_HIT_RECIPES_DIR', 'VIRAL_HIT_SKILLS_DIR'] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const root = await mkdtemp(join(tmpdir(), 'vh-composite-life-'));
  try { await run(await prepare(root)); }
  finally { for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } await rm(root, { recursive: true, force: true }); }
}
async function prepare(root: string) {
  process.env.VIRAL_HIT_DATA_DIR = join(root, 'source'); delete process.env.VIRAL_HIT_SKILLS_DIR;
  process.env.VIRAL_HIT_RECIPES_DIR = join(root, 'recipes'); await mkdir(process.env.VIRAL_HIT_RECIPES_DIR);
  const recipe = JSON.parse(await readFile('../../recipes/local-canvas.json', 'utf8'));
  await writeFile(join(root, 'recipes', 'canvas.json'), JSON.stringify(recipe));
  await writeFile(join(root, 'recipes', 'custom.json'), JSON.stringify({ ...recipe, id: 'custom-render' }));
  const official = JSON.parse(await readFile('skills/official/consistent-characters/skill.json', 'utf8'));
  const skill = { schemaVersion: 1, kind: 'viral-hit-skill', manifest: { ...official, id: 'portable-guidance', title: 'Portable guidance', version: '1.0.0' }, instructions: 'Keep the original composition and review each output.' };
  await changeSkillLibrary({ action: 'install', file: skill, expectedDigest: (await inspectSkillFile(skill)).digest });
  const images = [join(root, 'yellow.png'), join(root, 'blue.png')];
  for (const [index, color] of ['yellow', 'blue'].entries()) execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=80x80:d=1`, '-frames:v', '1', images[index]]);
  const profile = { name: 'Portable host', kind: 'mascot' as const, description: 'Yellow square', invariants: ['Keep the shape'], forbidden: [], providerIdentities: [], voice: { direction: 'Warm narrator' } };
  const host = await createCharacter({ id: 'portable-host', profile }, [{ path: images[0], role: 'canonical' }]);
  const blue = await createCharacter({ id: 'blue-host', profile: { ...profile, description: 'Blue square' } }, [{ path: images[1], role: 'canonical' }]);
  const first = await composeCreativePack({ id: 'composite-kit', version: '1.0.0', title: 'Composite kit', description: 'Portable general setup', scope: 'general', useCases: ['editing'], author: 'Independent author', license: 'MIT', recipeIds: ['local-canvas', 'custom-render'], skillIds: ['portable-guidance'], characterIds: ['portable-host'] });
  first.recipes.push({ ...(first.recipes[0] as object), id: 'composite-kit-dropped' });
  const next = structuredClone(first); next.version = '2.0.0'; next.scope = 'specialized'; next.useCases = ['products'];
  next.recipes = next.recipes.slice(0, 2).map(raw => ({ ...(raw as object), version: '2.0.0' }));
  next.recipes.push({ ...(next.recipes[0] as object), id: 'composite-kit-added' });
  next.skills[0].manifest.version = '2.0.0'; next.skills[0].instructions = 'Use a three-shot composition and review exact references.';
  next.characters[0].profile.description = 'Blue square for products'; delete next.characters[0].profile.voice; next.characters[0].references = blue.references;
  const files = [join(root, 'first.tar'), join(root, 'next.tar')];
  await writeCreativePack(first, files[0], AbortSignal.timeout(30_000)); await writeCreativePack(next, files[1], AbortSignal.timeout(30_000));
  process.env.VIRAL_HIT_DATA_DIR = join(root, 'destination');
  const installed = await changeCreativePacks({ action: 'install', path: files[0], expectedDigest: summarizeCreativePack(first).digest }) as CreativePackResult;
  assert.equal(installed.complete, true, installed.error);
  const inspect = (path = files[1]) => changeCreativePacks({ action: 'inspect', path }) as Promise<CreativePackInspection>;
  const update = async (review: CreativePackInspection, replaceKeys = review.update!.members.filter(member => member.change === 'different' && !member.reserved).map(member => member.key), path = files[1]) => changeCreativePacks({ action: 'update', path, expectedDigest: review.pack.digest, expectedStateDigest: review.update!.stateDigest, replaceKeys }) as Promise<CreativePackResult>;
  return { root, first, next, files, host, blue, images, inspect, update };
}

test('mixed release updates selected definitions and images, preserves custom/dropped recipes, queued plans and exact historical exports', () => fixture(async ({ root, first, next, files, host, blue, inspect, update }) => {
  const custom = await inspectRecipe({ ...readInstalledRecipes().find(recipe => recipe.id === 'composite-kit-custom-render')!, version: '9.0.0' });
  await changeRecipeLibrary({ action: 'update', manifest: custom.recipe, expectedDigest: custom.digest, expectedInstalledDigest: custom.update!.digest });
  const plan = await prepareRecipePlan('composite-kit-local-canvas', {}, 'project');
  let harness = new DurableHarness(join(root, 'jobs.sqlite')); const run = harness.enqueue(plan, 'before'), jobs = harness.jobs(run); harness.close();
  const review = await inspect(); assert.ok(review.update);
  const result = await update(review, ['recipe:composite-kit-local-canvas', 'skill:portable-guidance', 'character:portable-host']);
  assert.equal(result.complete, true, result.error);
  assert.equal(readInstalledRecipes().find(recipe => recipe.id === 'composite-kit-custom-render')!.version, '9.0.0');
  assert.ok(readInstalledRecipes().some(recipe => recipe.id === 'composite-kit-dropped'));
  assert.equal(readInstalledPacks()[0].content.state, 'modified');
  assert.equal((await getSkillRegistry()).get('portable-guidance')!.instructions, next.skills[0].instructions);
  assert.deepEqual(readCharacter(host.id)!.references, blue.references); assert.equal(readCharacter(host.id)!.voice, undefined);
  harness = new DurableHarness(join(root, 'jobs.sqlite')); assert.deepEqual(harness.jobs(run), jobs); harness.close();
  for (const [index, manifest] of [first, next].entries()) {
    const out = join(root, 'export-' + index + '.tar');
    await changeCreativePacks({ action: 'export', id: first.id, digest: summarizeCreativePack(manifest).digest, path: out });
    assert.deepEqual(await readFile(out), await readFile(files[index]));
  }
  await assert.rejects(update(review), /changed after review/);
}));

test('legacy completion records remain unchanged while new heads and retained snapshots support removal and reinstall', () => fixture(async ({ root, first, files, inspect, update }) => {
  const data = process.env.VIRAL_HIT_DATA_DIR!;
  await rm(join(data, 'creative-pack-library.sqlite')); await mkdir(join(data, 'creative-packs'));
  const legacy = join(data, 'creative-packs', first.id + '.json'), bytes = JSON.stringify(first);
  await writeFile(legacy, bytes);
  assert.match((await readCreativePackState(first.id)).revision, /^legacy:/);
  const result = await update(await inspect()); assert.equal(result.complete, true, result.error);
  assert.equal(await readFile(legacy, 'utf8'), bytes);
  const removal = await changeCreativePacks({ action: 'review-remove', id: first.id });
  assert.ok('stateDigest' in removal);
  const before = readInstalledRecipes();
  await changeCreativePacks({ action: 'remove', id: first.id, expectedStateDigest: removal.stateDigest });
  const catalog = await changeCreativePacks({ action: 'list' }); assert.ok('installed' in catalog);
  assert.equal(catalog.installed.length, 0); assert.equal(catalog.removed[0].id, first.id);
  assert.deepEqual(readInstalledRecipes(), before); assert.equal(readCharacter('portable-host')!.status, 'active');
  const out = join(root, 'removed-original.tar');
  await changeCreativePacks({ action: 'export', id: first.id, digest: summarizeCreativePack(first).digest, path: out });
  assert.deepEqual(await readFile(out), await readFile(files[0]));
  const history = await changeCreativePacks({ action: 'history', id: first.id }); assert.ok('releases' in history); assert.equal(history.releases.length, 2); assert.equal(history.currentDigest, null);
  const reinstalled = await changeCreativePacks({ action: 'install', path: files[1], expectedDigest: result.pack.digest }) as CreativePackResult;
  assert.equal(reinstalled.complete, true, reinstalled.error);
  assert.equal(await readFile(legacy, 'utf8'), bytes);
}));

test('partial cross-library failure retains the old release and fresh review resumes only unfinished replacements', () => fixture(async ({ root, first, next, inspect, update }) => {
  const db = new DatabaseSync(join(process.env.VIRAL_HIT_DATA_DIR!, 'skill-library.sqlite'));
  db.exec("CREATE TRIGGER reject_maintenance BEFORE UPDATE ON skills BEGIN SELECT RAISE(ABORT,'Simulated storage interruption'); END"); db.close();
  const result = await update(await inspect()); assert.equal(result.complete, false); assert.match(result.error!, /storage interruption/);
  assert.ok(result.items.some(item => item.kind === 'character' && item.state === 'updated'));
  assert.ok(result.items.some(item => item.kind === 'recipe' && item.state === 'updated'));
  assert.equal((await readStoredCreativePack(first.id))!.version, '1.0.0');
  const preservedVersion = readCharacter('portable-host')!.version;
  const repaired = new DatabaseSync(join(process.env.VIRAL_HIT_DATA_DIR!, 'skill-library.sqlite')); repaired.exec('DROP TRIGGER reject_maintenance'); repaired.close();
  const fresh = await inspect(); assert.deepEqual(fresh.update!.members.filter(member => member.change === 'different').map(member => member.key), ['skill:portable-guidance']);
  const resumed = await update(fresh); assert.equal(resumed.complete, true, resumed.error);
  assert.equal(readCharacter('portable-host')!.version, preservedVersion);
  assert.equal((await readStoredCreativePack(first.id))!.version, '2.0.0');
  assert.equal((await getSkillRegistry()).get('portable-guidance')!.instructions, next.skills[0].instructions);
}));

test('stale current definitions and new shared membership block before writes; reserved skills cannot be selected', () => fixture(async ({ root, first, next, files, inspect, update }) => {
  const review = await inspect();
  await changeCharacterLibrary({ action: 'update', id: 'portable-host', expectedVersion: 1, profile: { description: 'Local custom host' } });
  await assert.rejects(update(review), /changed after review/);
  assert.equal(readInstalledRecipes().find(recipe => recipe.id === 'composite-kit-local-canvas')!.version, '1.0.0');
  const fresh = await inspect();
  const shared = { ...first, id: 'shared-kit', recipes: [], characters: [] }, path = join(root, 'shared.tar');
  await writeCreativePack(shared, path, AbortSignal.timeout(30_000));
  await changeCreativePacks({ action: 'install', path, expectedDigest: summarizeCreativePack(shared).digest });
  await assert.rejects(update(fresh), /changed after review/);
  const latest = await inspect(); assert.ok(latest.update!.members.find(member => member.id === 'portable-guidance')!.otherPacks.some(pack => pack.id === 'shared-kit'));
  await assert.rejects(update(latest, ['skill:unknown']), /Only reviewed/);
  const official = (await getSkillRegistry()).get('consistent-characters')!;
  next.skills.push({ schemaVersion: 1, kind: 'viral-hit-skill', manifest: official.manifest, instructions: 'Changed official instructions' });
  const reservedPath = join(root, 'reserved.tar'), destination = process.env.VIRAL_HIT_DATA_DIR;
  process.env.VIRAL_HIT_DATA_DIR = join(root, 'source');
  try { await writeCreativePack(next, reservedPath, AbortSignal.timeout(30_000)); } finally { process.env.VIRAL_HIT_DATA_DIR = destination; }
  const reserved = await inspect(reservedPath);
  await assert.rejects(update(reserved, ['skill:consistent-characters'], reservedPath), /Only reviewed/);
  const bytes = new Uint8Array(await readFile(files[1]));
  const denied = await uploadPack(new Request('http://localhost/api/app/creative-packs/file?action=update&digest=' + latest.pack.digest, { method: 'POST', headers: { 'content-type': 'application/x-tar' }, body: bytes }));
  assert.equal(denied.status, 403);
  const stale = await uploadPack(new Request('http://localhost/api/app/creative-packs/file?action=update&digest=' + review.pack.digest, { method: 'POST', headers: { 'content-type': 'application/x-tar', 'x-viral-hit-workspace-request': '1', 'x-viral-hit-pack-update': JSON.stringify({ expectedStateDigest: review.update!.stateDigest, replaceKeys: [] }) }, body: bytes }));
  assert.equal(stale.status, 409);
  const pathInjection = await downloadPack(new Request('http://localhost/api/app/creative-packs', { method: 'POST', headers: { 'content-type': 'application/json', 'x-viral-hit-workspace-request': '1' }, body: JSON.stringify({ action: 'remove', id: first.id, expectedStateDigest: latest.update!.stateDigest, path: '/tmp/not-allowed' }) }));
  assert.equal(pathInjection.status, 400);
}));

test('unselected character changes still retain incoming image bytes in the downloadable release', () => fixture(async ({ root, first, next, files, host, blue, inspect, update }) => {
  const result = await update(await inspect(), []); assert.equal(result.complete, true, result.error);
  assert.deepEqual(readCharacter(host.id)!.references, host.references);
  const exported = join(root, 'kept-local.tar'); await changeCreativePacks({ action: 'export', id: first.id, path: exported });
  assert.deepEqual(await readFile(exported), await readFile(files[1]));
  const contents = await withCreativePack(exported, AbortSignal.timeout(30_000), async loaded => loaded.manifest);
  assert.deepEqual(contents.characters[0].references, blue.references);
  assert.ok((await readFile(referencePath(next.characters[0].references[0].sha256))).length > 0);
}));

test('separate CLI processes serialize competing release heads and preserve the original snapshot', () => fixture(async ({ root, first, inspect }) => {
  const releases = [{ ...first, version: '2.0.0', title: 'Release A' }, { ...first, version: '2.0.0', title: 'Release B' }];
  const files = [join(root, 'a.tar'), join(root, 'b.tar')];
  for (const [index, release] of releases.entries()) await writeCreativePack(release, files[index], AbortSignal.timeout(30_000));
  const reviews = await Promise.all(files.map(path => inspect(path)));
  const run = (index: number) => new Promise<string>((resolve, reject) => {
    const child = execFile(process.execPath, ['--import', 'tsx', 'scripts/creative-pack.ts', 'change'], { env: { ...process.env } }, (error, stdout, stderr) => error ? reject(new Error(stdout + stderr)) : resolve(stdout));
    child.stdin!.end(JSON.stringify({ action: 'update', path: files[index], expectedDigest: reviews[index].pack.digest, expectedStateDigest: reviews[index].update!.stateDigest, replaceKeys: [] }));
  });
  const outcomes = await Promise.allSettled([run(0), run(1)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(String((outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult).reason), /changed after review|membership changed/);
  const history = await changeCreativePacks({ action: 'history', id: first.id }); assert.ok('releases' in history);
  assert.equal(history.releases.length, 2); assert.ok(history.releases.some(release => release.digest === summarizeCreativePack(first).digest));
}));
