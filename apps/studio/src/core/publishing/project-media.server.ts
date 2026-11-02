import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getViralHitDataRoot } from '../../config/data-root';
import { getActiveProject } from '../projects/projects';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { LOCAL_PROJECT_ASSET_PROVIDER, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { publicationAssetSchema, type PublicationAsset, type PublicationSpec } from './contracts';
import { copyVerifiedMedia, mediaKey } from './media-files.server';
import { PublicationMediaStore } from './media-store.server';

/** Shared application boundary for all connectors: public callers supply IDs, never host paths. */
export function openProjectPublicationMedia(root = resolve(getViralHitDataRoot(), 'publication-media')) {
  const store = new PublicationMediaStore(root);
  async function active(projectId: string, signal: AbortSignal) {
    signal.throwIfAborted(); mediaKey(projectId);
    if (!await getActiveProject({ projectId })) throw new Error('Publication project is unavailable');
    signal.throwIfAborted();
  }
  return {
    close: () => store.close(),
    /** Type information only; no path or bytes leave this boundary. */
    async describe(projectId: string, assetId: string, signal: AbortSignal) {
      await active(projectId, signal); mediaKey(assetId);
      const source = await getProjectAssetById({ projectId, assetId });
      if (!source || source.storageProvider !== LOCAL_PROJECT_ASSET_PROVIDER || !source.mimeType?.startsWith(`${source.type}/`)) throw new Error('Select local media belonging to this project');
      return { type: source.type as string, mimeType: source.mimeType };
    },
    async pin(projectId: string, assetId: string, signal: AbortSignal) {
      await active(projectId, signal); mediaKey(assetId);
      const source = await getProjectAssetById({ projectId, assetId });
      if (!source || source.storageProvider !== LOCAL_PROJECT_ASSET_PROVIDER || !source.mimeType?.startsWith(`${source.type}/`)) throw new Error('Select local media belonging to this project');
      const asset = publicationAssetSchema.parse({ assetId: source.id, sha256: source.sha256, sizeBytes: source.sizeBytes, contentType: source.mimeType });
      const pinned = await store.prepare(projectId, asset, resolveLocalProjectAssetPath({ objectKey: source.objectKey }), signal);
      await active(projectId, signal);
      // Membership may have changed during a long preparation. Do not return an unowned pin.
      const current = await getProjectAssetById({ projectId, assetId });
      if (!current || current.sha256 !== asset.sha256 || current.sizeBytes !== asset.sizeBytes || current.mimeType !== asset.contentType) throw new Error('Project media identity changed during preparation');
      return pinned;
    },
    /**
     * Retains a converted copy (for example the JPEG Instagram downloads). The converter reads a private
     * hash-verified copy of the project file, so a later change to the original cannot alter the result.
     */
    async pinDerived(projectId: string, assetId: string, convert: (input: string, output: string) => Promise<string>, signal: AbortSignal) {
      await active(projectId, signal); mediaKey(assetId);
      const source = await getProjectAssetById({ projectId, assetId });
      if (!source || source.storageProvider !== LOCAL_PROJECT_ASSET_PROVIDER || !source.mimeType?.startsWith(`${source.type}/`)) throw new Error('Select local media belonging to this project');
      const original = publicationAssetSchema.parse({ assetId: source.id, sha256: source.sha256, sizeBytes: source.sizeBytes, contentType: source.mimeType });
      const directory = await mkdtemp(join(tmpdir(), 'vh-publication-'));
      try {
        const input = join(directory, 'source'), output = join(directory, 'converted.jpg'), handle = await open(input, 'wx', 0o600);
        try { await copyVerifiedMedia(resolveLocalProjectAssetPath({ objectKey: source.objectKey }), handle, original, signal); }
        finally { await handle.close(); }
        const contentType = await convert(input, output), bytes = await readFile(output);
        const derived = publicationAssetSchema.parse({ assetId: source.id, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, contentType });
        const pinned = await store.prepare(projectId, derived, output, signal);
        await active(projectId, signal);
        const current = await getProjectAssetById({ projectId, assetId });
        if (!current || current.sha256 !== original.sha256) throw new Error('Project media identity changed during preparation');
        return pinned;
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async inspectAsset(projectId: string, asset: PublicationAsset, signal: AbortSignal) {
      await active(projectId, signal);
      return store.inspectVideo(projectId, asset, signal);
    },
    async inspectVideo(spec: PublicationSpec, signal: AbortSignal) {
      await active(spec.projectId, signal);
      if (spec.assets.length !== 1) throw new Error('Select one video for inspection');
      return store.inspectVideo(spec.projectId, spec.assets[0], signal);
    },
    async validateAssets(spec: PublicationSpec, signal: AbortSignal) {
      await active(spec.projectId, signal);
      for (const asset of spec.assets) await store.check(spec.projectId, asset, signal);
    },
    async read(spec: PublicationSpec, assetIndex: number, offset: number, length: number, signal: AbortSignal) {
      await active(spec.projectId, signal);
      if (!Number.isSafeInteger(assetIndex) || assetIndex < 0 || assetIndex >= spec.assets.length) throw new Error('Unknown publication asset');
      return store.read(spec.projectId, spec.assets[assetIndex], offset, length, signal);
    },
  };
}
