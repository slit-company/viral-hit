import {
  isOfficialCloudApiInputUrl,
  isOfficialCloudApiMediaUrl,
  isPublicHttpMediaUrl,
} from './cloud-api-media-url';
import {
  readResponseBodyWithLimit,
  readResponseJsonWithLimit,
} from '@/lib/response-body-limit';

const MAX_MOTION_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MOTION_VIDEO_BYTES = 100 * 1024 * 1024;
const CLOUD_API_FILE_TIMEOUT_MS = 120_000;
const MAX_PROVIDER_JSON_BYTES = 1024 * 1024;

type MotionControlAssetKind = 'image' | 'video';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const readString = (value: unknown) =>
  typeof value === 'string' && value ? value : null;

const filenameFromUrl = (url: string, kind: MotionControlAssetKind) => {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    const sanitized = name.replace(/[^\w.\-]+/g, '_');
    if (sanitized) return sanitized;
  } catch {
    // fall through to the kind default
  }
  return kind === 'image' ? 'character.png' : 'motion.mp4';
};

const maxBytesForKind = (kind: MotionControlAssetKind) =>
  kind === 'image' ? MAX_MOTION_IMAGE_BYTES : MAX_MOTION_VIDEO_BYTES;

export const uploadCloudApiInputFile = async ({
  baseUrl,
  apiKey,
  body,
  contentType,
  filename,
}: {
  baseUrl: string;
  apiKey: string;
  body: Blob;
  contentType: string;
  filename: string;
}) => {
  const formData = new FormData();
  formData.set('file', new File([body], filename, { type: contentType }), filename);
  formData.set('purpose', 'input');
  const response = await fetch(`${baseUrl}/v1/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(CLOUD_API_FILE_TIMEOUT_MS),
  });
  const payload = await readResponseJsonWithLimit(
    response,
    MAX_PROVIDER_JSON_BYTES
  );
  if (!response.ok) {
    const root = asRecord(payload);
    const error = asRecord(root?.error);
    throw new Error(
      readString(error?.message) ??
        readString(root?.message) ??
        'Cloud API file upload failed'
    );
  }
  const data = asRecord(asRecord(payload)?.data) ?? asRecord(payload);
  const url = readString(data?.url);
  const key = readString(data?.key) ?? readString(data?.id);
  if (!url || !isPublicHttpMediaUrl(url)) {
    throw new Error('Cloud API upload response is incomplete');
  }
  return { url, key: key ?? url };
};

export const uploadCloudApiInputUrl = async (
  input: Parameters<typeof uploadCloudApiInputFile>[0]
) => (await uploadCloudApiInputFile(input)).url;

export const ensureCloudApiInputUrl = async ({
  url,
  kind,
  baseUrl,
  apiKey,
}: {
  url: string;
  kind: MotionControlAssetKind;
  baseUrl: string;
  apiKey: string;
}) => {
  if (isOfficialCloudApiInputUrl(url)) return url;
  if (isPublicHttpMediaUrl(url) && !isOfficialCloudApiMediaUrl(url)) return url;
  if (!isOfficialCloudApiMediaUrl(url)) {
    throw new Error(
      'Kling Motion Control inputs must use public HTTP(S) URLs'
    );
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(CLOUD_API_FILE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error('Failed to download generated media for Motion Control');
  }

  const declaredLength = Number(response.headers.get('content-length'));
  const maxBytes = maxBytesForKind(kind);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(
      kind === 'image'
        ? 'Kling Motion Control images must be 10 MB or smaller'
        : 'Kling Motion Control videos must be 100 MB or smaller'
    );
  }

  const bytes = await readResponseBodyWithLimit(response, maxBytes);
  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim() ||
    (kind === 'image' ? 'image/png' : 'video/mp4');
  const bodyBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(bodyBuffer).set(bytes);
  const blob = new Blob([bodyBuffer], { type: contentType });

  return uploadCloudApiInputUrl({
    baseUrl,
    apiKey,
    body: blob,
    contentType,
    filename: filenameFromUrl(url, kind),
  });
};

export const ensureMotionControlInputUrls = async ({
  imageUrl,
  videoUrl,
  baseUrl,
  apiKey,
}: {
  imageUrl: string;
  videoUrl: string;
  baseUrl: string;
  apiKey: string;
}) => {
  const [image, video] = await Promise.all([
    ensureCloudApiInputUrl({ url: imageUrl, kind: 'image', baseUrl, apiKey }),
    ensureCloudApiInputUrl({ url: videoUrl, kind: 'video', baseUrl, apiKey }),
  ]);
  return { imageUrl: image, videoUrl: video };
};
