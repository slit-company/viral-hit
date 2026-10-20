import { getConfig } from '@/modules/config/service';
import { requireCloudApiBaseUrl } from '@/core/generation-providers/cloud-api-endpoint.server';
import { uploadCloudApiInputFile } from '@/core/effects/cloud-api-input-upload';
import { validateStorageEndpoint } from '@/core/workspace-storage/endpoint-policy';
import { S3Provider } from '@/core/workspace-storage/provider/s3';
import type { StorageConfig } from '@/core/workspace-storage/types';

const CLOUD_API_UPLOAD_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'audio/aac',
  'audio/mp4',
  'video/mp4',
  'video/quicktime',
]);

const S3_UPLOAD_TYPES = new Set([
  ...CLOUD_API_UPLOAD_TYPES,
  'video/webm',
]);

export const getManagedGenerationInputMaxBytes = (mimeType: string) =>
  mimeType.startsWith('video/') ? 100 * 1024 * 1024 : 50 * 1024 * 1024;

async function loadCustomStorageConfig(): Promise<StorageConfig> {
  const [
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl,
    forcePathStyle,
  ] = await Promise.all([
    getConfig('R2_REGION'),
    getConfig('R2_ENDPOINT'),
    getConfig('R2_ACCESS_KEY_ID'),
    getConfig('R2_SECRET_ACCESS_KEY'),
    getConfig('R2_BUCKET_NAME'),
    getConfig('R2_PUBLIC_URL'),
    getConfig('R2_FORCE_PATH_STYLE'),
  ]);
  if (
    !endpoint ||
    !accessKeyId ||
    !secretAccessKey ||
    !bucketName ||
    !publicUrl
  ) {
    throw new Error(
      'Configure your own R2/S3 connection before using custom upload storage.'
    );
  }
  const endpointPolicy = validateStorageEndpoint(endpoint, {
    allowPrivate: false,
  });
  if (!endpointPolicy.ok) throw new Error(endpointPolicy.message);
  return {
    region: region || 'auto',
    endpoint: endpointPolicy.endpoint,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl,
    forcePathStyle: forcePathStyle !== 'false',
  };
}

export async function uploadManagedGenerationInput({
  body,
  filename,
  contentType,
}: {
  body: Blob;
  filename: string;
  contentType: string;
}) {
  if (body.size <= 0 || body.size > getManagedGenerationInputMaxBytes(contentType)) {
    throw new Error(
      `Generation input must be between 1 byte and ${
        getManagedGenerationInputMaxBytes(contentType) / (1024 * 1024)
      } MB.`
    );
  }

  const storageMode =
    (await getConfig('WORKSPACE_STORAGE_MODE')) === 's3' ? 's3' : 'cloud-api';
  if (storageMode === 's3') {
    if (!S3_UPLOAD_TYPES.has(contentType)) {
      throw new Error(`Unsupported generation input type: ${contentType}`);
    }
    const config = await loadCustomStorageConfig();
    const folder = contentType.startsWith('video/')
      ? 'workspace/videos'
      : contentType.startsWith('audio/')
        ? 'workspace/audio'
        : 'workspace/images';
    const result = await new S3Provider(config).uploadFile({
      file: body,
      filename,
      contentType,
      folder,
    });
    return {
      provider: 's3' as const,
      bucket: config.bucketName,
      key: result.key,
      url: result.url,
    };
  }

  if (!CLOUD_API_UPLOAD_TYPES.has(contentType)) {
    throw new Error(`Unsupported generation input type: ${contentType}`);
  }
  const apiKey = await getConfig('CLOUD_API_KEY');
  if (!apiKey) {
    throw new Error('Connect a Cloud API key before uploading files');
  }
  const result = await uploadCloudApiInputFile({
    baseUrl: requireCloudApiBaseUrl(),
    apiKey,
    body,
    contentType,
    filename,
  });
  return {
    provider: 'cloud-api' as const,
    bucket: 'cloud-api',
    key: result.key,
    url: result.url,
  };
}
