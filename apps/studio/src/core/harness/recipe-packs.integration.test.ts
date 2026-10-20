import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DurableHarness } from './durable';
import { compileRecipe, type Recipe } from './recipes';

const directory = await mkdtemp(join(tmpdir(), 'vh-recipe-packs-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(() => rm(directory, { recursive: true, force: true }));
const { createProject } = await import('../projects/projects');
const { importLocalProjectAsset } = await import('../projects/import-local-asset');
const { pinSequenceInputs, createSequenceAdapter } = await import('./sequence-adapter');
const { attachRunResult } = await import('./attach-result');
const { loadProjectTimeline } = await import('../editor/timeline-state');
const { renderProjectTimelineToAsset } = await import('../editor/render-project-timeline');
const { resolveLocalProjectAssetPath } = await import('../projects/local-project-assets');
const { getProjectAssetById } = await import('../workspace-lib/assets/user-assets');
const { probeMedia } = await import('./probe-media');
const { changeRecipePacks, inspectPack, installPack, listRecipePacks, validatePack } = await import('./recipe-pack-library');
const { loadRecipes } = await import('./recipe-registry');
const { readInstalledPacks } = await import('./recipe-storage');

const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const read = async (name: string) => JSON.parse(await readFile(join('../../packs', name + '.json'), 'utf8'));
const media = {
  video: ['-f', 'lavfi', '-i', 'testsrc2=s=360x640:d=10:r=15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
  audio: ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=12', '-c:a', 'pcm_s16le'],
  image: ['-f', 'lavfi', '-i', 'color=c=0x2255aa:s=360x640', '-frames:v', '1'],
} as const;
const files: Record<string, string> = {};
for (const [kind, args] of Object.entries(media)) {
  files[kind] = join(directory, kind + (kind === 'video' ? '.mp4' : kind === 'audio' ? '.wav' : '.png'));
  execFileSync(ffmpeg, ['-v', 'error', ...args, files[kind]]);
}

test('bundled packs separate general and situation-specific workflows and validate offline', async () => {
  const listed = await listRecipePacks();
  const scopes = Object.fromEntries(listed.available.map(item => [item.summary.id, item.summary.scope]));
  assert.deepEqual(scopes, { 'editing-basics': 'general', 'short-form-reel': 'specialized', 'slide-story': 'specialized' });
  assert.ok(listed.available.every(item => item.state === 'available'));
  const reel = await read('short-form-reel');
  assert.throws(() => validatePack({ ...reel, recipes: [{ ...reel.recipes[0], id: 'hook-cut' }] }), /must start with "short-form-reel-"/);
  assert.throws(() => validatePack({ ...reel, recipes: [reel.recipes[0], reel.recipes[0]] }), /Duplicate recipe ID/);
  assert.throws(() => validatePack({ ...reel, scope: 'ads' }));
  assert.throws(() => validatePack({ ...reel, description: 'x'.repeat(1_000_001) }), /1 MB/);
});

test('installation is reviewed, atomic, idempotent and immutable', async () => {
  const reel = await read('short-form-reel');
  const review = await inspectPack(reel);
  assert.equal(review.collision, 'none'); assert.deepEqual(review.blocking, []);
  assert.deepEqual(review.recipes.map(recipe => recipe.collision), ['none', 'none', 'none']);
  await assert.rejects(installPack(reel, '0'.repeat(64)), /changed after review/);
  const changed = structuredClone(reel); changed.recipes[1].title = 'Changed';
  await assert.rejects(installPack(changed, review.pack.digest), /changed after review/);
  // A conflicting recipe already in the library rejects the whole pack.
  const db = new DatabaseSync(join(directory, 'recipe-library.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, digest TEXT NOT NULL, installed_at INTEGER NOT NULL)');
  db.prepare('INSERT INTO recipes VALUES (?,?,?,?)').run('short-form-reel-study', JSON.stringify({ ...reel.recipes[2], title: 'Somebody else' }), 'x', 1);
  assert.deepEqual((await inspectPack(reel)).blocking, ['short-form-reel-study conflicts with an existing recipe.']);
  await assert.rejects(installPack(reel, review.pack.digest), /different contents/);
  assert.equal((await loadRecipes()).filter(recipe => recipe.id.startsWith('short-form-reel-')).length, 1);
  assert.deepEqual(readInstalledPacks(), []);
  db.prepare('DELETE FROM recipes WHERE id=?').run('short-form-reel-study'); db.close();
  const installed = await installPack(reel, review.pack.digest);
  assert.equal(installed.installed, true); assert.equal(installed.added.length, 3);
  assert.deepEqual(await installPack(reel, review.pack.digest), { pack: review.pack, installed: false, added: [] });
  assert.equal((await inspectPack(reel)).collision, 'same');
  const update = structuredClone(reel); update.version = '1.1.0';
  assert.match((await inspectPack(update)).blocking[0], /new pack ID/);
  await assert.rejects(installPack(update, (await inspectPack(update)).pack.digest), /different contents/);
  const listed = await changeRecipePacks({ action: 'list' }) as Awaited<ReturnType<typeof listRecipePacks>>;
  assert.equal(listed.available.find(item => item.summary.id === 'short-form-reel')?.state, 'installed');
});

async function runSequence(recipe: Recipe, values: Record<string, unknown>) {
  const project = await createProject({ name: recipe.title });
  const ids: Record<string, string> = {};
  for (const kind of ['video', 'audio', 'image'] as const) ids[kind] = (await importLocalProjectAsset({ projectId: project.id, filePath: files[kind] })).id;
  const supplied = Object.fromEntries(recipe.parameters.map(parameter => [parameter.id,
    parameter.type === 'asset' ? ids[parameter.kind] : values[parameter.id] ?? parameter.default]));
  const plan = await pinSequenceInputs(compileRecipe(recipe, supplied, project.id));
  const h = new DurableHarness(join(directory, project.id + '.sqlite'));
  try {
    const run = h.enqueue(plan, recipe.id);
    for (let i = 0; i < 4 && h.jobs(run)[0].state !== 'succeeded' && h.jobs(run)[0].state !== 'failed'; i++) await h.step(run, { 'editor.sequence': createSequenceAdapter() });
    const job = h.jobs(run)[0]; assert.equal(job.state, 'succeeded', job.error ?? recipe.id);
    assert.equal((await attachRunResult(h, project.id, run, job.id, 0)).ok, true);
  } finally { h.close(); }
  return { project, timeline: (await loadProjectTimeline(project.id))! };
}

test('every pack sequence recipe prepares editable tracks from real media', async () => {
  for (const name of ['short-form-reel', 'slide-story', 'editing-basics']) {
    const { recipes } = validatePack(await read(name));
    for (const recipe of recipes.filter(recipe => recipe.nodes[0].operation === 'editor.sequence')) {
      const { timeline } = await runSequence(recipe, {});
      const clips = timeline.document.tracks.flatMap(track => track.clips);
      const expected = recipe.nodes[0].input as { tracks: { clips: unknown[] }[] };
      assert.equal(clips.length, expected.tracks.reduce((n, track) => n + track.clips.length, 0), recipe.id);
      assert.ok(timeline.document.duration > 0, recipe.id);
    }
  }
});

test('the reel hook cut renders a vertical MP4 with the chosen hook and narration length', async () => {
  const { recipes } = validatePack(await read('short-form-reel'));
  const recipe = recipes.find(item => item.id === 'short-form-reel-hook-cut')!;
  const { project, timeline } = await runSequence(recipe, { hook: 'THREE TRICKS', 'voice-length': 4 });
  const clips = timeline.document.tracks.flatMap(track => track.clips);
  assert.equal(clips.find(clip => clip.text === 'THREE TRICKS')?.duration, 2.5);
  assert.equal(clips.find(clip => clip.audioRole === 'voice')?.duration, 4);
  assert.equal(clips.find(clip => clip.sourceType === 'video')?.muted, true);
  assert.equal(timeline.document.duration, 8);
  const rendered = await renderProjectTimelineToAsset({ projectId: project.id, document: timeline.document, timelineRevision: timeline.version });
  const asset = (await getProjectAssetById({ projectId: project.id, assetId: rendered.id }))!;
  const info = await probeMedia(resolveLocalProjectAssetPath({ objectKey: asset.objectKey }), 'video', AbortSignal.timeout(30_000));
  assert.ok(info.height! > info.width!, 'export stays vertical');
  assert.ok(Math.abs(info.durationMs! - 8000) < 150);
  assert.equal(info.hasAudio, true);
});
test('people can build a shareable pack from recipes they already have', async () => {
  const { buildPack } = await import('./recipe-pack-library');
  const meta = { id: 'team-launch', title: 'Team launch kit', description: 'Our launch formats.', author: 'A team', license: 'CC-BY-4.0', scope: 'specialized' as const, useCases: ['launch'] };
  const built = await buildPack({ ...meta, recipeIds: ['open-frame', 'short-form-reel-hook-cut'] });
  const manifest = built.manifest;
  assert.deepEqual(manifest.recipes.map(recipe => recipe.id), ['team-launch-open-frame', 'team-launch-short-form-reel-hook-cut']);
  assert.equal(manifest.version, '1.0.0');
  // Recipe attribution stays with each recipe; the pack license only covers the bundle.
  assert.deepEqual(manifest.recipes.map(recipe => recipe.license), ['Apache-2.0', 'Apache-2.0']);
  assert.deepEqual(built.inspection.blocking, []);
  const installed = await installPack(manifest, built.inspection.pack.digest);
  assert.deepEqual(installed.added, ['team-launch-open-frame', 'team-launch-short-form-reel-hook-cut']);
  assert.ok((await loadRecipes()).some(recipe => recipe.id === 'open-frame'), 'originals stay');
  await assert.rejects(buildPack({ ...meta, recipeIds: ['missing-recipe'] }), /not found/);
  await assert.rejects(buildPack({ ...meta, recipeIds: ['open-frame', 'open-frame'] }), /each recipe once/);
  await assert.rejects(buildPack({ ...meta, scope: 'everyone' as never, recipeIds: ['open-frame'] }));
});
test('shared pack links download with media safeguards and return a reviewable manifest', async () => {
  const { fetchPackFromLink } = await import('./recipe-pack-source');
  const { writeFile } = await import('node:fs/promises');
  const story = await read('slide-story');
  const requested: { url: string; max: number }[] = [];
  const serve = (body: string) => async (url: string, destination: string, _signal: AbortSignal, max?: number) => { requested.push({ url, max: max! }); await writeFile(destination, body); };
  const fetched = await fetchPackFromLink('https://github.com/acme/packs/blob/main/slides/slide-story.json', AbortSignal.timeout(5000), serve(JSON.stringify(story)));
  assert.equal(fetched.source, 'https://raw.githubusercontent.com/acme/packs/main/slides/slide-story.json');
  assert.deepEqual(requested[0], { url: fetched.source, max: 1_000_000 });
  const review = await inspectPack(fetched.manifest);
  assert.equal(review.pack.id, 'slide-story'); assert.deepEqual(review.blocking, []);
  await assert.rejects(fetchPackFromLink('https://example.com/p.json', AbortSignal.timeout(5000), serve('<html>')), /did not return a pack file/);
  await assert.rejects(fetchPackFromLink('https://example.com/p.json', AbortSignal.timeout(5000), async () => { throw new Error('Media exceeds download limit'); }), /Pack exceeds 1 MB pack limit/);
  await assert.rejects(fetchPackFromLink('http://example.com/p.json'), /requires HTTPS/);
  await assert.rejects(fetchPackFromLink('https://10.0.0.8/p.json'), /public network address/);
  await assert.rejects(inspectPack({ name: 'not a pack' }), /not a Viral Hit pack/);
});
