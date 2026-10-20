import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
const directory = await mkdtemp(join(tmpdir(), 'vh-bundle-test-'));
process.env.VIRAL_HIT_DATA_DIR = directory;
execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { env: process.env, stdio: 'pipe' });
after(async () => rm(directory, { recursive: true, force: true }));
const { getDb } = await import('@/core/workspace-lib/db-adapter');
const { userAsset, projectCanvasState, projectTimelineState, projectAssetMembership } = await import('@/config/db/schema');
const { createProject, getProject, deleteProjects } = await import('../projects');
const { importLocalProjectAsset } = await import('../import-local-asset');
const { normalizeProjectSnapshotDocument } = await import('../project-snapshot');
const { resolveLocalProjectAssetPath } = await import('../local-project-assets');
const { createTimelineDocument, addSourceClip, addOverlayClip, addTimelineTake, setTimelineOverlayMotion } = await import('@/core/editor/timeline-document');
const { exportProjectBundle } = await import('./export.server');
const { inspectProjectBundle, acceptProjectBundle, readImportReview } = await import('./import.server');
const { openProjectBundleDownload } = await import('./download.server');
const { bundlePath, receiveBundle } = await import('./storage.server');
const { scanTar, tarHeader } = await import('./tar.server');
const db = await getDb();
const signal = () => AbortSignal.timeout(30_000);
const image = join(directory, 'mark.png'), video = join(directory, 'scene.mp4');
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=96x64', '-frames:v', '1', image]);
execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=128x72:d=2:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
async function fixture() {
  const p = await createProject({ name: 'Portable motion' });
  const mark = await importLocalProjectAsset({ projectId: p.id, filePath: image });
  const scene = await importLocalProjectAsset({ projectId: p.id, filePath: video });
  let timeline = addSourceClip(createTimelineDocument({ projectId: p.id, name: 'Scene' }), { assetId: scene.id, sourceUrl: scene.publicUrl, name: 'Scene', sourceType: 'video', sourceDuration: 2 });
  timeline = addOverlayClip(timeline, { assetId: mark.id, sourceUrl: mark.publicUrl, name: 'Mark', duration: 2, startTime: 0, width: .2 });
  const clip = timeline.tracks.find(t => t.kind === 'overlay')!.clips[0];
  timeline = setTimelineOverlayMotion(timeline, clip.id, { version: 1, keyframes: [
    { id: 'a', time: 0, x: .2, y: .3, width: .2, opacity: .5, rotation: 0, easing: 'linear' },
    { id: 'b', time: 2, x: .8, y: .7, width: .4, opacity: 1, rotation: 30, easing: 'ease-in-out' },
  ] });
  timeline = addTimelineTake(timeline, timeline.tracks[0].clips[0].id, { id: 'alternative', assetId: scene.id, sourceUrl: scene.publicUrl, name: 'Alternative', sourceType: 'video', sourceDuration: 2, sourceGenerationId: 'private-job', prompt: 'Alternate pacing' });
  timeline.lastRenderAssetId = scene.id; timeline.lastRenderUrl = scene.publicUrl;
  await db.insert(projectTimelineState).values({ projectId: p.id, documentJson: timeline, version: 7 });
  const canvas = normalizeProjectSnapshotDocument({ version: 3, cards: [
    { id: 'reference', kind: 'asset', type: 'image', assetId: mark.id, name: 'Mark', url: mark.publicUrl, status: 'succeeded', referenceCardIds: [] },
    { id: 'prompt', kind: 'generation', type: 'image', name: 'Remix', prompt: 'A brighter stage', status: 'processing', sourceGenerationId: 'private-job', referenceCardIds: ['reference'] },
  ], frames: { reference: { x: 40, y: 50, width: 320, height: 280 } }, camera: { x: 12, y: 14, zoom: .8 } });
  await db.update(projectCanvasState).set({ documentJson: canvas, version: 4 }).where(eq(projectCanvasState.projectId, p.id));
  return { p, mark, scene, timeline, canvas };
}
async function exported() { const f = await fixture(); const result = await exportProjectBundle(f.p.id, signal()); return { ...f, result, path: bundlePath(result.id, 'project.tar') }; }
async function inspected(path: string) { return inspectProjectBundle(createReadStream(path), signal()); }

test('independent tar reader and roundtrip retain motion, graph and exact media', async () => {
  const f = await exported();
  const listing = execFileSync('tar', ['-tf', f.path], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(listing.length, 3); assert.equal(listing[0], 'manifest.json');
  const manifest = execFileSync('tar', ['-xOf', f.path, 'manifest.json'], { encoding: 'utf8' });
  assert.ok(!manifest.includes('private-job')); assert.ok(!manifest.includes('/api/app/projects/'));
  const review = await inspected(f.path); assert.equal(await getProject({ projectId: review.id }), null);
  assert.deepEqual(review.summary.revisions, { canvas: 4, timeline: 7 });
  const result = await acceptProjectBundle(review.id, review.sha256, signal());
  assert.equal(result.replayed, false); assert.notEqual(result.projectId, f.p.id);
  const [{ documentJson: restored }] = await db.select().from(projectTimelineState).where(eq(projectTimelineState.projectId, result.projectId));
  assert.equal(restored.lastRenderAssetId, null); assert.equal(restored.lastRenderUrl, null);
  const motion = restored.tracks.flatMap((t: typeof f.timeline.tracks[number]) => t.clips).find((c: typeof f.timeline.tracks[number]['clips'][number]) => c.motion)!;
  assert.deepEqual(motion.motion, f.timeline.tracks.flatMap(t => t.clips).find(c => c.motion)!.motion);
  assert.equal(restored.tracks[0].clips[0].takes[0].sourceGenerationId, null);
  assert.ok(restored.tracks[0].clips[0].takes[0].sourceUrl.includes(result.projectId));
  assert.ok(motion.sourceUrl.includes(result.projectId)); assert.notEqual(motion.assetId, f.mark.id);
  const [{ documentJson: canvas }] = await db.select().from(projectCanvasState).where(eq(projectCanvasState.projectId, result.projectId));
  assert.deepEqual(canvas.frames, f.canvas.frames); assert.deepEqual(canvas.camera, f.canvas.camera);
  assert.deepEqual(canvas.cards[1].referenceCardIds, ['reference']); assert.equal(canvas.cards[1].status, 'idle');
  const media = await db.select().from(userAsset).where(eq(userAsset.originProjectId, result.projectId));
  for (const asset of media) assert.equal(createHash('sha256').update(await readFile(resolveLocalProjectAssetPath(asset))).digest('hex'), asset.sha256);
  assert.equal(media.find((a: {type: string}) => a.type === 'video').durationMs, 2000);
  const download = await openProjectBundleDownload(f.result.id, signal()); await download.file.close();
  assert.equal(download.receipt.sha256, f.result.sha256);
  await assert.rejects(acceptProjectBundle(review.id, '0'.repeat(64)), /stale/);
  assert.equal((await acceptProjectBundle(review.id, review.sha256)).replayed, true);
  await deleteProjects({ projectIds: [result.projectId] });
  assert.equal((await acceptProjectBundle(review.id, review.sha256)).status, 'deleted');
});
test('transaction failure exposes no partial project and retry registers only once', async () => {
  const f = await exported(), review = await inspected(f.path);
  await db.run(sql.raw("CREATE TRIGGER reject_bundle BEFORE INSERT ON project_timeline_state BEGIN SELECT RAISE(ABORT, 'simulated disk commit failure'); END"));
  try { await assert.rejects(acceptProjectBundle(review.id, review.sha256)); }
  finally { await db.run(sql.raw('DROP TRIGGER reject_bundle')); }
  assert.equal(await getProject({ projectId: review.id }), null);
  assert.equal((await db.select().from(userAsset).where(eq(userAsset.originProjectId, review.id))).length, 0);
  assert.equal((await db.select().from(projectAssetMembership).where(eq(projectAssetMembership.projectId, review.id))).length, 0);
  assert.equal((await acceptProjectBundle(review.id, review.sha256)).replayed, false);
  assert.equal((await acceptProjectBundle(review.id, review.sha256)).replayed, true);
});
test('tampered staged media or review metadata cannot create a project', async () => {
  const f = await exported(), review = await inspected(f.path), { manifest } = await readImportReview(review.id);
  const media = bundlePath(review.id, manifest.assets[0].sha256);
  const bytes = await readFile(media); bytes[0] ^= 1; await writeFile(media, bytes);
  await assert.rejects(acceptProjectBundle(review.id, review.sha256), /checksum/);
  assert.equal(await getProject({ projectId: review.id }), null);
  manifest.project.name = 'Changed after review'; await writeFile(bundlePath(review.id, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(acceptProjectBundle(review.id, review.sha256), /metadata changed/);
});
test('archive rejects corruption, traversal, links, duplicates, missing end and extra members', async () => {
  const f = await exported(), bytes = await readFile(f.path), members = await scanTar(f.path);
  const fixChecksum = (buffer: Buffer) => { buffer.fill(32, 148, 156); const sum = buffer.subarray(0, 512).reduce((n, b) => n + b, 0); buffer.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii'); };
  const variants: Buffer[] = [];
  const traversal = Buffer.from(bytes); traversal.fill(0, 0, 100); traversal.write('../manifest.json'); fixChecksum(traversal); variants.push(traversal);
  const hidden = Buffer.from(bytes); hidden[0] |= 128; fixChecksum(hidden); variants.push(hidden);
  const link = Buffer.from(bytes); link[156] = 50; fixChecksum(link); variants.push(link);
  variants.push(Buffer.concat([bytes.subarray(0, -1024), tarHeader('manifest.json', 0), Buffer.alloc(1024)]));
  variants.push(bytes.subarray(0, -1024));
  const corrupt = Buffer.from(bytes), firstMedia = [...members.entries()].find(([name]) => name.startsWith('media/'))![1]; corrupt[firstMedia.offset] ^= 1; variants.push(corrupt);
  variants.push(Buffer.concat([bytes.subarray(0, -1024), tarHeader(`media/${'0'.repeat(64)}`, 0), Buffer.alloc(1024)]));
  for (const bytes of variants) await assert.rejects(inspectProjectBundle((async function* () { yield bytes; })(), signal()));
});
test('foreign and missing media fail export instead of silently omitting assets', async () => {
  const f = await fixture();
  await db.update(userAsset).set({ storageProvider: 's3' }).where(eq(userAsset.id, f.mark.id));
  await assert.rejects(exportProjectBundle(f.p.id), /Localize/);
  await db.update(userAsset).set({ storageProvider: 'local' }).where(eq(userAsset.id, f.mark.id));
  const [row] = await db.select().from(userAsset).where(eq(userAsset.id, f.mark.id));
  await rm(resolveLocalProjectAssetPath(row)); await assert.rejects(exportProjectBundle(f.p.id));
});
test('an idle upload can be aborted without waiting for another chunk', async () => {
  const controller = new AbortController();
  const pending = receiveBundle({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: async () => ({ done: true, value: undefined }) }) }, controller.signal);
  setTimeout(() => controller.abort(Error('deadline')), 25);
  await assert.rejects(pending, /deadline/);
});
