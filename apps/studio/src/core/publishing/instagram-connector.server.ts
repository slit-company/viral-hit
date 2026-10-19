import { PublicationStartError, PublicationPublishError, type PublicationConnector, type PublicationSpec, type TransferObservation, type RemoteObservation } from './contracts';
import { instagramCheckpointSchema, instagramIdSchema, instagramMetadataSchema, instagramReceiptSchema, type InstagramCheckpoint, type InstagramContainer } from './instagram-contract';
import { createInstagramTransport, type InstagramCredential } from './instagram-transport.server';
import { InstagramTransportError } from './instagram-http.server';
import type { JsonValue } from '../../lib/canonical-json';

export const INSTAGRAM_CONNECTOR_VERSION = '1';
type Options = { credential: (accountId: string, signal: AbortSignal) => Promise<InstagramCredential>; fetch?: typeof fetch; invalidateCredential?: (accountId: string, token: string, revision?: number) => Promise<void> };
export function validateInstagramPublication(spec: PublicationSpec) {
  if (spec.connector !== 'instagram' || spec.connectorVersion !== INSTAGRAM_CONNECTOR_VERSION || spec.assets.length !== 1 || spec.assets[0].contentType !== 'video/mp4') throw new Error('Instagram requires one MP4 video and a supported connector');
  return { instagramId: instagramIdSchema.parse(spec.destinationId), sizeBytes: spec.assets[0].sizeBytes, metadata: instagramMetadataSchema.parse(spec.metadata) };
}

/** Facebook Login for Business, local Reels/Stories videos. No public media hosting required. */
export function createInstagramConnector(options: Options): PublicationConnector {
  const transport = (spec: PublicationSpec) => createInstagramTransport({ credential: signal => options.credential(spec.accountId, signal), fetch: options.fetch, invalidateCredential: credential => options.invalidateCredential?.(spec.accountId, credential.accessToken, credential.revision) ?? Promise.resolve() });
  function target(spec: PublicationSpec, raw: JsonValue, receipt = false) {
    const input = validateInstagramPublication(spec);
    const identity = receipt ? instagramReceiptSchema.parse(raw) : instagramCheckpointSchema.parse(raw);
    if (identity.instagramId !== input.instagramId || ('nextByte' in identity && identity.nextByte > input.sizeBytes)) throw new Error('Instagram checkpoint identity changed');
    return { containerId: identity.containerId, pageId: identity.pageId, instagramId: input.instagramId, sizeBytes: input.sizeBytes };
  }
  function receipt(identity: { containerId: string; instagramId: string; pageId: string }, status: InstagramContainer['status'], mediaId?: string) {
    return { containerId: identity.containerId, instagramId: identity.instagramId, pageId: identity.pageId, status, ...(mediaId ? { mediaId } : {}) };
  }
  function transferred(identity: InstagramCheckpoint, result: InstagramContainer): TransferObservation {
    if (result.status === 'EXPIRED') return { kind: 'uncertain', issue: 'session-expired' };
    if (result.status !== 'IN_PROGRESS' || result.upload?.status === 'complete' || result.upload?.status === 'error') return { kind: 'accepted', receipt: receipt(identity, result.upload?.status === 'error' ? 'ERROR' : result.status) };
    if (!result.upload) return { kind: 'uncertain', issue: 'upload-unknown' };
    return { kind: 'progress', checkpoint: { ...identity, nextByte: result.upload.bytesTransferred }, retryAfterMs: 60000 };
  }
  function observed(identity: { containerId: string; instagramId: string; pageId: string }, result: InstagramContainer, mediaId?: string): RemoteObservation {
    const state = result.status === 'PUBLISHED' ? 'published' : (['ERROR', 'EXPIRED'].includes(result.status) || result.upload?.status === 'error') ? 'failed' : result.status === 'FINISHED' ? 'staged' : 'processing';
    return { state, receipt: receipt(identity, result.status, mediaId), retryAfterMs: 60000 };
  }
  return {
    id: 'instagram', version: INSTAGRAM_CONNECTOR_VERSION,
    async start(spec, signal) {
      let input: ReturnType<typeof validateInstagramPublication>;
      try { input = validateInstagramPublication(spec); } catch { throw new PublicationStartError('rejected'); }
      try { return await transport(spec).create(input.instagramId, input.metadata, signal); }
      catch (error) { if (error instanceof InstagramTransportError && error.outcome === 'unavailable') throw new PublicationStartError('unavailable'); throw error; }
    },
    async transfer(spec, raw, read, signal) {
      const identity = target(spec, raw);
      const result = await transport(spec).upload(identity, (offset, length) => read(0, offset, length), signal);
      return transferred(instagramCheckpointSchema.parse(raw), result);
    },
    async reconcile(spec, raw, signal) {
      const identity = target(spec, raw);
      return transferred(instagramCheckpointSchema.parse(raw), await transport(spec).status(identity, signal));
    },
    async inspect(spec, raw, signal) {
      const identity = target(spec, raw, true), prior = instagramReceiptSchema.parse(raw);
      return observed(identity, await transport(spec).status(identity, signal), prior.mediaId);
    },
    async publish(spec, raw, signal) {
      const identity = target(spec, raw, true);
      try {
        const result = await transport(spec).publish(identity, signal);
        return observed(identity, result.container, result.mediaId);
      } catch (error) {
        if (error instanceof InstagramTransportError && error.outcome === 'unavailable') throw new PublicationPublishError('unavailable');
        throw error;
      }
    },
  };
}
