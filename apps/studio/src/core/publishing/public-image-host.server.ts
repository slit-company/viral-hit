import { S3mini } from 's3mini';
import { getFreshConfigs } from '@/modules/config/service';
import { validateStorageEndpoint } from '../workspace-storage/endpoint-policy';

/** The workspace's own S3-compatible storage (R2, S3, B2…) with a public base URL Meta can download from. */
export type PublicImageHostConfig = { region: string; endpoint: string; accessKeyId: string; secretAccessKey: string; bucketName: string; publicUrl: string };
const KEYS = ['R2_REGION', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'] as const;

export function publicImageHostConfig(values: Partial<Record<(typeof KEYS)[number], string>>): PublicImageHostConfig | null {
  const { R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET_NAME: bucketName, R2_PUBLIC_URL: publicUrl } = values;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)) return null;
  const api = validateStorageEndpoint(endpoint), site = validateStorageEndpoint(publicUrl);
  if (!api.ok || !site.ok) return null;
  return { region: values.R2_REGION || 'auto', endpoint: api.endpoint, accessKeyId, secretAccessKey, bucketName, publicUrl: site.endpoint };
}
/** Content-addressed: the same approved JPEG always maps to the same unguessable object. */
export const publicImageUrl = (config: Pick<PublicImageHostConfig, 'publicUrl'>, sha256: string) => {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid image digest');
  return `${config.publicUrl}/instagram/${sha256}.jpg`;
};
type Image = { sha256: string; sizeBytes: number };
export type PublicImageHost = ReturnType<typeof openPublicImageHost>;

export function openPublicImageHost(options: { fetch?: typeof fetch; config?: () => Promise<PublicImageHostConfig | null> } = {}) {
  const request = options.fetch ?? fetch;
  // Long-lived workers must see a storage change saved by the studio process.
  const config = options.config ?? (async () => publicImageHostConfig(await getFreshConfigs(KEYS)));
  async function reachable(url: string, image: Image, signal: AbortSignal) {
    try {
      const response = await request(url, { method: 'HEAD', redirect: 'error', cache: 'no-store', signal });
      const length = response.headers.get('content-length'), type = response.headers.get('content-type');
      return response.status === 200 && (length === null || Number(length) === image.sizeBytes) && (type === null || type.toLowerCase().startsWith('image/jpeg'));
    } catch { signal.throwIfAborted(); return false; }
  }
  return {
    configured: async () => Boolean(await config()),
    /** URL Meta can download now, or null. Read-only; used immediately before container creation. */
    async verify(image: Image, signal: AbortSignal) {
      const current = await config();
      if (!current) return null;
      const url = publicImageUrl(current, image.sha256);
      return await reachable(url, image, signal) ? url : null;
    },
    /** Idempotent copy of approved bytes; an existing identical public object is reused. */
    async publish(image: Image, read: () => Promise<Uint8Array>, signal: AbortSignal) {
      const current = await config();
      if (!current) throw new Error('Public image storage is not configured');
      const url = publicImageUrl(current, image.sha256);
      if (await reachable(url, image, signal)) return url;
      const bytes = await read();
      if (bytes.byteLength !== image.sizeBytes) throw new Error('Approved image size changed');
      const client = new S3mini({ accessKeyId: current.accessKeyId, secretAccessKey: current.secretAccessKey, endpoint: `${current.endpoint}/${current.bucketName}`, region: current.region, fetch: request, requestAbortTimeout: 45000 });
      const abort = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      const response = await Promise.race([client.putObject(`instagram/${image.sha256}.jpg`, Buffer.from(bytes), 'image/jpeg'), abort]);
      if (!response.ok) throw new Error('Public image storage rejected the upload');
      if (!await reachable(url, image, signal)) throw new Error('The uploaded image is not publicly reachable');
      return url;
    },
  };
}
