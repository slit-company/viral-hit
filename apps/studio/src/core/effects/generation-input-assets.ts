import { completeGenerationUploadIntent, getCompletedIntentUploads } from './generation-upload-intent';
import { linkGenerationAsset, linkGenerationInputAssetsByUrls, recordUserAsset, type AssetType } from '../workspace-lib/assets/user-assets';

/** Retain admitted uploads and their project-scoped generation input memberships. */
const assetTypeFromMime = (mimeType: string | null): AssetType => {
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  return 'image';
};

export async function finalizeIntentUploads({
  intentId,
  generationId,
}: {
  intentId: string;
  generationId: string;
}) {
  const uploads = await getCompletedIntentUploads({ intentId });
  for (const upload of uploads) {
    if (!upload.publicUrl || !upload.objectKey) continue;
    const assetId = await recordUserAsset({
      type: assetTypeFromMime(upload.mimeType),
      source: 'upload',
      assetClass: 'original',
      storageProvider: upload.storageProvider ?? 'cloud-api',
      bucket: upload.bucket ?? upload.storageProvider ?? 'cloud-api',
      objectKey: upload.objectKey,
      publicUrl: upload.publicUrl,
      filename: upload.filename ?? undefined,
      mimeType: upload.mimeType ?? undefined,
      sizeBytes: upload.sizeBytes ?? undefined,
      metadata: { generationIntentId: intentId },
    });
    await linkGenerationAsset({
      generationId,
      assetId,
      role: 'input',
    });
  }
  if (!await completeGenerationUploadIntent({ intentId, generationId })) throw Error('Generation receipt could not be finalized; inspect its original intent before taking further action');
}

export async function linkInputAssets(
  generationId: string,
  input: Record<string, unknown>
) {
  for (const key of ['image_urls', 'video_urls', 'audio_urls'] as const) {
    const urls = Array.isArray(input[key])
      ? input[key].filter((item): item is string => typeof item === 'string')
      : [];
    if (urls.length) {
      await linkGenerationInputAssetsByUrls({ generationId, urls });
    }
  }
}
