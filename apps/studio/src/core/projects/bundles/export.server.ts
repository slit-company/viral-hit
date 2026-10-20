import { open, rm, stat } from 'node:fs/promises';
import { probeMedia } from '@/core/harness/probe-media';
import { eq } from 'drizzle-orm';
import { getDb } from '@/core/workspace-lib/db-adapter';
import type { createSqliteDb } from '@/core/db/sqlite';
import { project, projectCanvasState, projectTimelineState, projectAssetMembership, userAsset } from '@/config/db/schema';
import { normalizeProjectSnapshotDocument } from '../project-snapshot';
import { normalizeTimelineDocument } from '@/core/editor/timeline-document';
import { resolveWorkspaceMode } from '@/config/workspace-modes';
import { LOCAL_PROJECT_ASSET_BUCKET, resolveLocalProjectAssetPath } from '../local-project-assets';
import { bundleManifest, MAX_MANIFEST_BYTES } from './contract';
import { inspectBundle, mapBundleDocuments, validateMediaRanges } from './documents';
import { copyVerified, writeTar } from './tar.server';
import { bundlePath, createBundleStage, writeBundleJson } from './storage.server';

async function readSource(projectId: string) {
  const db = await getDb() as Awaited<ReturnType<typeof createSqliteDb>>;
  return db.transaction(async tx => {
    const [p] = await tx.select().from(project).where(eq(project.id, projectId));
    if (!p || p.status !== 'active') throw Error('Project not found');
    const [canvas] = await tx.select().from(projectCanvasState).where(eq(projectCanvasState.projectId, projectId));
    const [timeline] = await tx.select().from(projectTimelineState).where(eq(projectTimelineState.projectId, projectId));
    const rows = await tx.select({ asset: userAsset }).from(projectAssetMembership).innerJoin(userAsset, eq(projectAssetMembership.assetId, userAsset.id)).where(eq(projectAssetMembership.projectId, projectId));
    const assets = [...new Map(rows.map(row => [row.asset.id, row.asset])).values()].sort((a, b) => a.id.localeCompare(b.id));
    if (assets.length > 500) throw Error('A project file supports at most 500 assets');
    return { p, canvas, timeline, assets };
  });
}
export async function exportProjectBundle(projectId: string, signal = AbortSignal.timeout(10 * 60_000)) {
  const source = await readSource(projectId), signature = JSON.stringify(source);
  const manifest = bundleManifest.parse({ format: 'viral-hit-project', version: 1, createdAt: new Date().toISOString(),
    project: { id: projectId, name: source.p.name, workspaceMode: resolveWorkspaceMode(source.p.lastWorkspaceMode), coverAssetId: source.p.coverAssetId },
    revisions: { canvas: source.canvas?.version ?? 1, timeline: source.timeline?.version ?? 0 },
    canvas: normalizeProjectSnapshotDocument(source.canvas?.documentJson),
    timeline: source.timeline ? normalizeTimelineDocument(source.timeline.documentJson, projectId) : null,
    assets: source.assets.map(asset => ({ id: asset.id, filename: asset.filename ?? asset.id, kind: asset.type, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes,
      sha256: asset.sha256, width: asset.width, height: asset.height, durationMs: asset.durationMs })),
  });
  const mapped = mapBundleDocuments(manifest, projectId, new Map(manifest.assets.map(asset => [asset.id, asset.id])), true);
  manifest.canvas = mapped.canvas; manifest.timeline = mapped.timeline;
  const sources = new Map<string, { hash: string; path: string; size: number }>();
  for (const asset of source.assets) {
    if (asset.bucket !== LOCAL_PROJECT_ASSET_BUCKET || asset.storageProvider !== 'local') throw Error(`Localize project media before export: ${asset.filename ?? asset.id}`);
    const path = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
    await copyVerified(path, null, { size: asset.sizeBytes!, sha256: asset.sha256!, signal });
    const info = await probeMedia(path, asset.type as 'image' | 'video' | 'audio', signal);
    const item = manifest.assets.find(item => item.id === asset.id)!;
    Object.assign(item, { mimeType: info.mimeType, width: info.width, height: info.height, durationMs: info.durationMs });
    sources.set(asset.sha256!, { hash: asset.sha256!, path, size: asset.sizeBytes! });
  }
  validateMediaRanges(manifest);
  const summary = inspectBundle(manifest), bytes = Buffer.from(JSON.stringify(manifest));
  if (bytes.length > MAX_MANIFEST_BYTES) throw Error('Project metadata exceeds 5 MiB');
  const id = await createBundleStage(), path = bundlePath(id, 'project.tar'), file = await open(path, 'wx', 0o600);
  try {
    await writeTar(file, bytes, [...sources.values()], signal);
    // Reads and network work remain outside the write transaction.
    if (JSON.stringify(await readSource(projectId)) !== signature) throw Error('Project changed during export. Save edits and prepare a new file.');
  } catch (error) { await file.close(); await rm(path, { force: true }); throw error; }
  finally { await file.close(); }
  const sizeBytes = (await stat(path)).size;
  const sha256 = await copyVerified(path, null, { size: sizeBytes, signal });
  await writeBundleJson(id, 'receipt.json', { kind: 'export', projectId, sha256, sizeBytes });
  return { id, sha256, sizeBytes, summary, downloadUrl: `/api/app/project-bundles/${id}/download` };
}
