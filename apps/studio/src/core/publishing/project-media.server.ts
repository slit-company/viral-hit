import { resolve } from 'node:path';
import { getViralHitDataRoot } from '../../config/data-root';
import { getActiveProject } from '../projects/projects';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { LOCAL_PROJECT_ASSET_PROVIDER, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { publicationAssetSchema, type PublicationSpec } from './contracts';
import { mediaKey } from './media-files.server';
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
