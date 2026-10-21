import { stageStoryboardAttachment } from '@/core/storyboards/portable.server';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/core/workspace-lib/db-adapter';
import type { createSqliteDb } from '@/core/db/sqlite';
import { project, userAsset, projectAssetMembership, projectCanvasState, projectTimelineState } from '@/config/db/schema';
import { probeMedia } from '@/core/harness/probe-media';
import { buildLocalProjectAssetUrl, createLocalProjectAssetObjectKey, resolveLocalProjectAssetPath, sanitizeLocalProjectAssetFilename, LOCAL_PROJECT_ASSET_BUCKET } from '../local-project-assets';
import { bundleId, bundleManifest, mediaMember, type BundleManifest } from './contract';
import { inspectBundle, mapBundleDocuments, validateMediaRanges } from './documents';
import { bundlePath, readBundleJson, receiveBundle, writeBundleJson } from './storage.server';
import { copyVerified, readExactly, scanTar } from './tar.server';

const receiptSchema = z.object({ kind: z.literal('import'), sha256: z.string().regex(/^[a-f0-9]{64}$/), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export async function inspectProjectBundle(source: AsyncIterable<Uint8Array>, signal = AbortSignal.timeout(10 * 60_000)) {
  const received = await receiveBundle(source, signal);
  const members = await scanTar(received.path), entry = members.get('manifest.json');
  if (!entry) throw Error('Project manifest is missing');
  const file = await open(received.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let manifest: BundleManifest;
  try { manifest = bundleManifest.parse(JSON.parse((await readExactly(file, entry.offset, entry.size)).toString('utf8'))); }
  finally { await file.close(); }
  const hashes = new Map(manifest.assets.map(asset => [asset.sha256, asset]));
  if (members.size !== hashes.size + 1 || [...hashes.keys()].some(hash => !members.has(mediaMember(hash)))) throw Error('Archive members do not match the manifest');
  inspectBundle(manifest);
  for (const [digest, asset] of hashes) {
    const member = members.get(mediaMember(digest))!;
    if (member.size !== asset.sizeBytes) throw Error('Archive media size mismatch');
    const path = bundlePath(received.id, digest), target = await open(path, 'wx', 0o600);
    try { await copyVerified(received.path, target, { ...member, sha256: digest, signal }); await target.sync(); }
    finally { await target.close(); }
    const info = await probeMedia(path, asset.kind, signal);
    for (const item of manifest.assets.filter(item => item.sha256 === digest)) {
      if (item.kind !== info.kind) throw Error('One media identity cannot have conflicting kinds');
      item.mimeType = info.mimeType; item.width = info.width; item.height = info.height; item.durationMs = info.durationMs;
    }
  }
  validateMediaRanges(manifest);
  const summary = inspectBundle(manifest);
  await writeBundleJson(received.id, 'manifest.json', manifest);
  await writeBundleJson(received.id, 'receipt.json', { kind: 'import', sha256: received.sha256, manifestSha256: hash(JSON.stringify(manifest)) });
  return { id: received.id, sha256: received.sha256, summary };
}
export async function readImportReview(id: string) {
  const receipt = receiptSchema.parse(await readBundleJson(id, 'receipt.json', 4096));
  const raw = await readBundleJson(id, 'manifest.json');
  if (hash(JSON.stringify(raw)) !== receipt.manifestSha256) throw Error('Reviewed project metadata changed');
  const manifest = bundleManifest.parse(raw);
  return { receipt, manifest, summary: inspectBundle(manifest) };
}
export async function acceptProjectBundle(id: string, expectedDigest: string, signal = AbortSignal.timeout(10 * 60_000)) {
  bundleId.parse(id);
  const { receipt, manifest } = await readImportReview(id);
  if (expectedDigest !== receipt.sha256) throw Error('Project file review is stale');
  const db = await getDb() as Awaited<ReturnType<typeof createSqliteDb>>;
  const [existing] = await db.select({ id: project.id, status: project.status }).from(project).where(eq(project.id, id));
  if (existing) return { projectId: id, replayed: true, status: existing.status };
  const ids = new Map(manifest.assets.map(asset => [asset.id, hash(`${id}:${asset.id}`).slice(0, 48)]));
  const mapped = mapBundleDocuments(manifest, id, ids, false);
  const records: (typeof userAsset.$inferInsert)[] = [];
  for (const asset of manifest.assets) {
    const assetId = ids.get(asset.id)!, filename = sanitizeLocalProjectAssetFilename({ filename: asset.filename, mimeType: asset.mimeType });
    const objectKey = createLocalProjectAssetObjectKey({ projectId: id, assetId, filename });
    const destination = resolveLocalProjectAssetPath({ objectKey });
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 }); resolveLocalProjectAssetPath({ objectKey });
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600);
    try {
      await copyVerified(bundlePath(id, asset.sha256), file, { size: asset.sizeBytes, sha256: asset.sha256, signal }); await file.sync();
      await file.close(); await rename(temporary, resolveLocalProjectAssetPath({ objectKey }));
    } catch (error) { await file.close(); await rm(temporary, { force: true }); throw error; }
    finally { await file.close(); }
    records.push({ id: assetId, type: asset.kind, source: 'upload', assetClass: 'original', storageProvider: 'local', bucket: LOCAL_PROJECT_ASSET_BUCKET,
      objectKey, publicUrl: buildLocalProjectAssetUrl({ projectId: id, assetId }), filename, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes,
      sha256: asset.sha256, width: asset.width, height: asset.height, durationMs: asset.durationMs, originProjectId: id });
  }
  signal.throwIfAborted();
  // Storyboards stage under the new, still-invisible project identity before activation.
  if (manifest.storyboards) stageStoryboardAttachment(manifest.storyboards, id, ids);
  signal.throwIfAborted();
  // The file copies are private until this single transaction becomes visible.
  return db.transaction(async tx => {
    const [replay] = await tx.select({ id: project.id, status: project.status }).from(project).where(eq(project.id, id));
    if (replay) return { projectId: id, replayed: true, status: replay.status };
    const now = new Date();
    await tx.insert(project).values({ id, name: manifest.project.name, coverAssetId: mapped.coverAssetId, status: 'active', currentStateVersion: 1,
      lastWorkspaceMode: manifest.project.workspaceMode, lastOpenedAt: now, createdAt: now, updatedAt: now });
    for (const record of records) {
      await tx.insert(userAsset).values(record);
      await tx.insert(projectAssetMembership).values({ id: hash(`${id}:${record.id}:member`), projectId: id, assetId: record.id, category: 'upload', role: 'upload' });
    }
    await tx.insert(projectCanvasState).values({ projectId: id, documentJson: mapped.canvas, version: 1, updatedAt: now });
    if (mapped.timeline) await tx.insert(projectTimelineState).values({ projectId: id, documentJson: mapped.timeline, version: 1, updatedAt: now });
    return { projectId: id, replayed: false, status: 'active' };
  });
}
