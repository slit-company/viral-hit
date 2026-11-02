import { instagramNotBefore } from './instagram-schedule';
import { PublicationInspectionPaused, PublicationStartError, PublicationPublishError, type PublicationConnector, type PublicationSpec, type TransferObservation, type RemoteObservation } from './contracts';
import { instagramCheckpointSchema, instagramIdSchema, instagramReceiptSchema, type InstagramCheckpoint, type InstagramContainer } from './instagram-contract';
import { instagramFormat } from './instagram-format';
import { createInstagramPostFlow } from './instagram-post.server';
import { openPublicImageHost, type PublicImageHost } from './public-image-host.server';
import { createInstagramTransport, type InstagramCredential } from './instagram-transport.server';
import { InstagramTransportError } from './instagram-http.server';
import type { JsonValue } from '../../lib/canonical-json';
import { instagramInsightRequest, instagramMeasurement } from './platform-metrics';
import { MeasurementUnavailable } from '../measurement/contract';

export const INSTAGRAM_CONNECTOR_VERSION = '1';
type Options = { credential: (accountId: string, signal: AbortSignal) => Promise<InstagramCredential>; fetch?: typeof fetch; invalidateCredential?: (accountId: string, token: string, revision?: number) => Promise<void>; imageHost?: PublicImageHost; carouselWaitMs?: number };
export function validateInstagramPublication(spec: PublicationSpec) {
  const format = spec.connector === 'instagram' && spec.connectorVersion === INSTAGRAM_CONNECTOR_VERSION ? instagramFormat(spec) : null;
  if (!format) throw new Error('Instagram media does not match the selected format or connector');
  return { instagramId: instagramIdSchema.parse(spec.destinationId), sizeBytes: spec.assets[0].sizeBytes, metadata: format.metadata, post: format.post };
}

/**
 * Facebook Login for Business. Reels and video Stories upload local bytes; image posts, image Stories and
 * carousels need the workspace's public image storage because Meta downloads images itself.
 */
export function createInstagramConnector(options: Options): PublicationConnector {
  const transport = (spec: PublicationSpec) => createInstagramTransport({ credential: signal => options.credential(spec.accountId, signal), fetch: options.fetch, invalidateCredential: credential => options.invalidateCredential?.(spec.accountId, credential.accessToken, credential.revision) ?? Promise.resolve() });
  const posts = createInstagramPostFlow({ transport, host: options.imageHost ?? openPublicImageHost({ fetch: options.fetch }), carouselWaitMs: options.carouselWaitMs });
  const isPost = (spec: PublicationSpec) => validateInstagramPublication(spec).post;
  function target(spec: PublicationSpec, raw: JsonValue, receipt = false) {
    const input = validateInstagramPublication(spec);
    const identity = receipt ? instagramReceiptSchema.parse(raw) : instagramCheckpointSchema.parse(raw);
    if (identity.instagramId !== input.instagramId || ('nextByte' in identity && identity.nextByte > input.sizeBytes)) throw new Error('Instagram checkpoint identity changed');
    return { containerId: identity.containerId, pageId: identity.pageId, instagramId: input.instagramId, sizeBytes: input.sizeBytes, ...(input.metadata.publishAt ? { publishAt: input.metadata.publishAt } : {}) };
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
    return { state, receipt: receipt(identity, result.status, mediaId), retryAfterMs: state === 'staged' ? 0 : 60000 };
  }
  return {
    id: 'instagram', version: INSTAGRAM_CONNECTOR_VERSION,
    notBefore: (spec, phase) => instagramNotBefore(validateInstagramPublication(spec).metadata, phase),
    prepare: async (spec, read, signal) => { if (isPost(spec)) await posts.prepare(spec, read, signal); },
    async start(spec, signal) {
      let input: ReturnType<typeof validateInstagramPublication>;
      try { input = validateInstagramPublication(spec); } catch { throw new PublicationStartError('rejected'); }
      if (input.post) return posts.start(spec, signal);
      try { return await transport(spec).create(input.instagramId, input.metadata, signal); }
      catch (error) { if (error instanceof InstagramTransportError && error.outcome === 'unavailable') throw new PublicationStartError('unavailable'); throw error; }
    },
    async transfer(spec, raw, read, signal) {
      if (isPost(spec)) return posts.transfer(spec, raw, read, signal);
      const identity = target(spec, raw);
      const result = await transport(spec).upload(identity, (offset, length) => read(0, offset, length), signal);
      return transferred(instagramCheckpointSchema.parse(raw), result);
    },
    async reconcile(spec, raw, signal) {
      if (isPost(spec)) return posts.reconcile(spec, raw, signal);
      const identity = target(spec, raw);
      return transferred(instagramCheckpointSchema.parse(raw), await transport(spec).status(identity, signal));
    },
    async inspect(spec, raw, signal) {
      if (isPost(spec)) return posts.inspect(spec, raw, signal);
      const identity = target(spec, raw, true), prior = instagramReceiptSchema.parse(raw);
      const result = await transport(spec).status(identity, signal);
      const observation = observed(identity, result, prior.mediaId);
      const polls = result.status === 'IN_PROGRESS' ? Math.min(5, (prior.processingPolls ?? 0) + 1) : prior.processingPolls ?? 0;
      if (polls > 0) observation.receipt = { ...instagramReceiptSchema.parse(observation.receipt), processingPolls: polls };
      if (observation.state === 'processing' && polls >= 5) throw new PublicationInspectionPaused(observation.receipt);
      return observation;
    },
    async publish(spec, raw, signal) {
      if (isPost(spec)) return posts.publish(spec, raw, signal);
      const identity = target(spec, raw, true);
      try {
        const result = await transport(spec).publish(identity, signal);
        return observed(identity, result.container, result.mediaId);
      } catch (error) {
        if (error instanceof InstagramTransportError && error.outcome === 'unavailable') throw new PublicationPublishError('unavailable');
        throw error;
      }
    },
    async measure(spec, raw, signal) {
      const kind = validateInstagramPublication(spec).metadata.kind;
      const identity = isPost(spec) ? posts.target(spec, raw) : target(spec, raw, true);
      const mediaId = isPost(spec) ? posts.mediaId(spec, raw) : instagramReceiptSchema.parse(raw).mediaId;
      if (!mediaId) throw new MeasurementUnavailable('not-found');
      let response: unknown;
      // Graph does not return a safe reason; a missing insights permission and an outage look alike here.
      try { response = await transport(spec).insights(identity, mediaId, instagramInsightRequest(kind), signal); }
      catch { throw new MeasurementUnavailable('unavailable'); }
      return instagramMeasurement(kind, response);
    },
  };
}
