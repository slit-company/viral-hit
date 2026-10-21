import type { AssetFirstGenerationRequest } from '../commands/generation-contract';
import { readProjectMediaInput, verifyProjectMediaInput } from '../harness/project-media-input';
import type { ProjectMediaPin } from '../harness/project-media-input-schema';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { localReferenceUrl, MAX_PROVIDER_MEDIA_BYTES, MAX_PROVIDER_TOTAL_MEDIA_BYTES, parseLocalReference } from './local-reference';

export async function prepareLocalGenerationReferences(generation: AssetFirstGenerationRequest) {
  if (new Set(generation.references.map(ref => ref.assetId)).size > 20) throw Error('Local providers accept at most 20 references');
  const urls = new Map<string, string>();
  let bytes = 0;
  const signal = AbortSignal.timeout(60_000);
  for (const ref of generation.references) {
    if (urls.has(ref.assetId)) continue;
    const asset = await getProjectAssetById({ projectId: generation.projectId, assetId: ref.assetId });
    if (!asset || asset.storageProvider !== 'local') throw Error('This provider needs local project media. Import a local copy first.');
    bytes += asset.sizeBytes ?? MAX_PROVIDER_TOTAL_MEDIA_BYTES + 1;
    if (bytes > MAX_PROVIDER_TOTAL_MEDIA_BYTES) throw Error('Provider references exceed 256 MiB');
    const { mimeType: _, filename: __, ...pin } = await verifyProjectMediaInput({ projectId: generation.projectId, assetId: ref.assetId, kind: asset.type, maxBytes: MAX_PROVIDER_MEDIA_BYTES, signal });
    urls.set(ref.assetId, localReferenceUrl(pin));
  }
  return {
    generation: { ...generation, references: generation.references.map(ref => ({ ...ref, deliveryUrl: urls.get(ref.assetId)! })) },
    authorizedDeliveryUrls: [...urls.values()],
  };
}

function referenceUrls(input: Record<string, unknown>) {
  const values = [input.videoUrl, ...(Array.isArray(input.imageUrls) ? input.imageUrls : []), ...(Array.isArray(input.videoUrls) ? input.videoUrls : []), ...(Array.isArray(input.audioUrls) ? input.audioUrls : [])];
  return [...new Set(values.filter((item): item is string => typeof item === 'string'))];
}

/** A call-scoped reader. Only declared pinned inputs are readable; status polling gets no reader. */
export async function createProviderMediaContext(projectId: unknown, input: Record<string, unknown>, signal: AbortSignal) {
  if (typeof projectId !== 'string' || !projectId) throw Error('Local provider inputs require an authorized project');
  const pins = new Map<string, ProjectMediaPin>();
  let total = 0;
  for (const url of referenceUrls(input)) {
    const pin = parseLocalReference(url);
    if (!pin || pin.projectId !== projectId) throw Error('Provider input is not an authorized local reference for this project');
    pins.set(url, pin); total += pin.sizeBytes;
  }
  if (pins.size > 20 || total > MAX_PROVIDER_TOTAL_MEDIA_BYTES) throw Error('Local provider input budget exceeded');
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  // Recheck after admission, before importing or invoking the provider module.
  for (const pin of pins.values()) await verifyProjectMediaInput({ ...pin, expected: pin, maxBytes: MAX_PROVIDER_MEDIA_BYTES, signal: combined });
  let active = true, readBytes = 0;
  const pending = new Set<Promise<unknown>>();
  return {
    media: [...pins].map(([referenceUrl, pin]) => Object.freeze({ referenceUrl, ...pin })),
    readMedia(referenceUrl: string) {
      const pin = pins.get(referenceUrl);
      if (!active || !pin) throw Error('Local media reader is closed or reference was not admitted');
      readBytes += pin.sizeBytes;
      if (readBytes > MAX_PROVIDER_TOTAL_MEDIA_BYTES) throw Error('Local provider read budget exceeded');
      const result = readProjectMediaInput({ ...pin, expected: pin, maxBytes: MAX_PROVIDER_MEDIA_BYTES, signal: combined });
      pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    },
    async dispose() {
      active = false; controller.abort(new Error('Provider call finished'));
      await Promise.allSettled([...pending]);
    },
  };
}
