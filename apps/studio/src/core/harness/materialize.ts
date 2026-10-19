import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { getActiveProject } from '../projects/projects';
import { buildLocalProjectAssetUrl, createLocalProjectAssetObjectKey, LOCAL_PROJECT_ASSET_BUCKET, LOCAL_PROJECT_ASSET_PROVIDER, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { getProjectAssetById, linkProjectAsset, recordUserAsset } from '../workspace-lib/assets/user-assets';
import { type Adapter, RejectedSubmission } from './durable';
import { downloadMedia } from './download-media';
import { probeMedia } from './probe-media';
import { binaryReference, readBinaryReceipt } from './binary-receipts';
import { fileHash } from './media-files';
export { fileHash } from './media-files';

const mediaFields = { kind: z.enum(['image', 'video', 'audio']), label: z.string().trim().min(1).max(160).optional() };
export const materializeInput = z.union([
  // Placeholders are allowed before dependency binding; submit validates the resolved source.
  z.object({ ...mediaFields, url: z.string().max(16000) }).strict(),
  z.object({ ...mediaFields, receipt: binaryReference.nullable() }).strict(),
]);
export const stableAssetId = (projectId: string, key: string) => 'vh-' + createHash('sha256').update(JSON.stringify([projectId, key])).digest('hex');

/** Local, replay-safe stage. The paid generation is a separate durable dependency. */
export function createMaterializeAdapter(dependencies = { download: downloadMedia, probe: probeMedia }): Adapter {
  return {
    recovery: 'replay',
    async submit(raw, context) {
      const parsed = materializeInput.safeParse(raw);
      if (!parsed.success || !context.projectId || !context.runId || !context.jobId) throw new RejectedSubmission('Invalid materialization input or missing project execution context');
      const { projectId } = context;
      if (!await getActiveProject({ projectId })) throw new RejectedSubmission('Project not found');
      const input = parsed.data, assetId = stableAssetId(projectId, context.key);
      const objectKey = createLocalProjectAssetObjectKey({ projectId, assetId, filename: 'output.bin' });
      const file = resolveLocalProjectAssetPath({ objectKey });
      await mkdir(dirname(file), { recursive: true });
      resolveLocalProjectAssetPath({ objectKey });
      const existing = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new RejectedSubmission('Stored media path is not a regular file');
      if (!existing) {
        const temporary = `${file}.partial-${randomUUID()}`;
        try {
          if ('url' in input) await dependencies.download(input.url, temporary, context.signal);
          else {
            if (!input.receipt) throw new RejectedSubmission('Binary receipt binding is missing');
            const saved = await readBinaryReceipt({ projectId, jobId: input.receipt.jobId }, context.signal);
            if (!saved || saved.receipt.sha256 !== input.receipt.sha256) throw new RejectedSubmission('Binary receipt is unavailable in this project or its hash does not match');
            await copyFile(saved.file, temporary, constants.COPYFILE_EXCL);
            if (await fileHash(temporary, context.signal) !== input.receipt.sha256) throw new RejectedSubmission('Binary receipt changed while copying; original generation was not repeated');
          }
          await dependencies.probe(temporary, input.kind, context.signal);
          // Atomic no-overwrite publication. Replayed jobs recover the same immutable bytes.
          try { await link(temporary, file); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        } finally { await unlink(temporary).catch(() => undefined); }
      }
      const info = await dependencies.probe(file, input.kind, context.signal);
      const sha256 = await fileHash(file, context.signal), sizeBytes = (await lstat(file)).size;
      if ('receipt' in input && (!input.receipt || input.receipt.sha256 !== sha256)) throw new RejectedSubmission('Stored media does not match its binary receipt');
      const previous = await getProjectAssetById({ projectId, assetId });
      if (previous?.sha256 && previous.sha256 !== sha256) throw new RejectedSubmission('Stored media integrity mismatch; original generation was not repeated');
      const publicUrl = buildLocalProjectAssetUrl({ projectId, assetId });
      await recordUserAsset({
        id: assetId, type: info.kind, source: 'provider', bucket: LOCAL_PROJECT_ASSET_BUCKET,
        objectKey, publicUrl, mimeType: info.mimeType, sizeBytes, sha256,
        filename: `${(input.label ?? 'Generated media').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100)}.${info.extension}`,
        storageProvider: LOCAL_PROJECT_ASSET_PROVIDER, originProjectId: projectId,
        width: info.width ?? undefined, height: info.height ?? undefined, durationMs: info.durationMs ?? undefined,
        metadata: { source: 'viral-hit-harness', runId: context.runId, jobId: context.jobId, sourceHost: 'url' in input ? new URL(input.url).hostname : null, binaryReceipt: 'receipt' in input ? input.receipt : null, hasAudio: info.hasAudio },
      });
      // sourceRunId belongs to the studio workflow_run table, not the independent harness DB.
      await linkProjectAsset({ projectId, assetId, role: 'generated', metadata: { harnessRunId: context.runId, jobId: context.jobId, sha256 } });
      return { id: `${projectId}/${assetId}` };
    },
    async poll(id, _input, signal) {
      const [projectId, assetId, extra] = id.split('/');
      if (!projectId || !assetId || extra) return { state: 'failed', error: 'Invalid local media receipt' };
      signal.throwIfAborted();
      const asset = await getProjectAssetById({ projectId, assetId });
      if (!asset) return { state: 'failed', error: 'Imported asset is missing from this project' };
      const file = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
      if (!asset.sha256 || await fileHash(file, signal) !== asset.sha256) return { state: 'failed', error: 'Imported media failed integrity verification' };
      return { state: 'succeeded', output: {
        assetId, projectId, publicUrl: asset.publicUrl, kind: asset.type,
        sha256: asset.sha256, sizeBytes: asset.sizeBytes ?? null,
        mimeType: asset.mimeType ?? null, width: asset.width ?? null, height: asset.height ?? null,
        durationMs: asset.durationMs ?? null, mediaMaterialized: true,
      } };
    },
    // Local import may finish before cancellation reaches the worker; poll reports actual completion.
    async cancel() {},
  };
}
