import type { ProjectMediaPin } from '../harness/project-media-input-schema';

export const MAX_PROVIDER_MEDIA_BYTES = 64 * 1024 * 1024;
export const MAX_PROVIDER_TOTAL_MEDIA_BYTES = 256 * 1024 * 1024;
const prefix = 'viral-hit-project://media/';

/** These identifiers carry no credentials or host paths and are not network addresses. */
export function localReferenceUrl(pin: ProjectMediaPin) {
  return prefix + [pin.projectId, pin.assetId, pin.kind, pin.sha256, pin.sizeBytes].map(String).map(encodeURIComponent).join('/');
}

export function parseLocalReference(value: string): ProjectMediaPin | null {
  if (!value.startsWith(prefix)) return null;
  try {
    const [projectId, assetId, kind, sha256, size, ...extra] = value.slice(prefix.length).split('/').map(decodeURIComponent);
    const sizeBytes = Number(size);
    if (extra.length || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId) || !/^[A-Za-z0-9_-]{1,128}$/.test(assetId) || !['image', 'video', 'audio'].includes(kind) || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_PROVIDER_MEDIA_BYTES) return null;
    const pin = { projectId, assetId, kind: kind as ProjectMediaPin['kind'], sha256, sizeBytes };
    return localReferenceUrl(pin) === value ? pin : null;
  } catch { return null; }
}

export function localReferencePlaybackUrl(value: string) {
  const pin = parseLocalReference(value);
  return pin ? `/api/app/projects/${encodeURIComponent(pin.projectId)}/assets/${encodeURIComponent(pin.assetId)}` : value;
}
