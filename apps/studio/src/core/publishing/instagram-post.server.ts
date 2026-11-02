import { PublicationInspectionPaused, PublicationPublishError, PublicationStartError, type PublicationSpec, type RemoteObservation, type TransferObservation } from './contracts';
import { instagramIdSchema, instagramPostCheckpointSchema, instagramPostReceiptSchema, type InstagramContainer, type InstagramPostCheckpoint, type InstagramPostReceipt } from './instagram-contract';
import { instagramFormat } from './instagram-format';
import { InstagramTransportError } from './instagram-http.server';
import type { createInstagramTransport, InstagramPostRequest } from './instagram-transport.server';
import type { PublicImageHost } from './public-image-host.server';
import type { JsonValue } from '../../lib/canonical-json';

type Transport = ReturnType<typeof createInstagramTransport>;
type Read = (asset: number, offset: number, length: number) => Promise<Uint8Array>;
const CAROUSEL_WAITS = 6, CAROUSEL_DEFERRALS = 20;
const failedStatus = (item: InstagramContainer) => item.status === 'ERROR' || item.status === 'EXPIRED' || item.upload?.status === 'error';
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener('abort', stop, { once: true });
});

function input(spec: PublicationSpec) {
  const format = instagramFormat(spec);
  if (!format?.post) throw new Error('Not an Instagram image post');
  return { instagramId: instagramIdSchema.parse(spec.destinationId), metadata: format.metadata, video: (index: number) => spec.assets[index].contentType === 'video/mp4' };
}
function checkpointOf(spec: PublicationSpec, raw: JsonValue) {
  const value = instagramPostCheckpointSchema.parse(raw), { instagramId, video } = input(spec);
  if (value.instagramId !== instagramId || value.items.length !== spec.assets.length
    || value.items.some((item, index) => video(index) !== (item.nextByte !== undefined) || (item.nextByte ?? 0) > spec.assets[index].sizeBytes)) throw new Error('Instagram checkpoint identity changed');
  return value;
}
function receiptOf(spec: PublicationSpec, raw: JsonValue) {
  const value = instagramPostReceiptSchema.parse(raw), { instagramId, metadata } = input(spec);
  if (value.instagramId !== instagramId || value.items.length !== spec.assets.length || (metadata.kind !== 'carousel' && value.containerId !== value.items[0])) throw new Error('Instagram receipt identity changed');
  return value;
}
const accepted = (spec: PublicationSpec, checkpoint: InstagramPostCheckpoint, status: InstagramPostReceipt['status'] = 'IN_PROGRESS'): TransferObservation => ({ kind: 'accepted', receipt: {
  post: 1, instagramId: checkpoint.instagramId, pageId: checkpoint.pageId, items: checkpoint.items.map(item => item.containerId),
  ...(input(spec).metadata.kind === 'carousel' ? {} : { containerId: checkpoint.items[0].containerId }), status,
} });
function observed(receipt: InstagramPostReceipt, container: InstagramContainer, mediaId?: string): RemoteObservation {
  const state = container.status === 'PUBLISHED' ? 'published' : failedStatus(container) ? 'failed' : container.status === 'FINISHED' ? 'staged' : 'processing';
  return { state, receipt: { ...receipt, status: container.status, ...(mediaId ? { mediaId } : {}) }, retryAfterMs: state === 'staged' ? 0 : 60000 };
}

/** Image posts, image Stories and carousels. Public hosting happens before the start fence and is safe to repeat. */
export function createInstagramPostFlow(options: { transport: (spec: PublicationSpec) => Transport; host: PublicImageHost; carouselWaitMs?: number }) {
  /** Moves one resumable carousel video forward and reports the next durable step. */
  function advance(spec: PublicationSpec, checkpoint: InstagramPostCheckpoint, index: number, result: InstagramContainer): TransferObservation {
    if (result.status === 'EXPIRED') return { kind: 'uncertain', issue: 'session-expired' };
    if (failedStatus(result)) return accepted(spec, checkpoint, 'ERROR');
    if (result.status === 'IN_PROGRESS' && result.upload?.status !== 'complete') {
      if (!result.upload) return { kind: 'uncertain', issue: 'upload-unknown' };
      return { kind: 'progress', checkpoint: { ...checkpoint, items: checkpoint.items.map((item, at) => at === index ? { ...item, nextByte: result.upload!.bytesTransferred } : item) }, retryAfterMs: 60000 };
    }
    const next = { ...checkpoint, items: checkpoint.items.map((item, at) => at === index ? { ...item, nextByte: spec.assets[index].sizeBytes } : item) };
    return next.items.some((item, at) => item.nextByte !== undefined && item.nextByte < spec.assets[at].sizeBytes) ? { kind: 'progress', checkpoint: next, retryAfterMs: 0 } : accepted(spec, next);
  }
  const pending = (spec: PublicationSpec, checkpoint: InstagramPostCheckpoint) => checkpoint.items.findIndex((item, index) => item.nextByte !== undefined && item.nextByte < spec.assets[index].sizeBytes);
  async function statuses(spec: PublicationSpec, receipt: InstagramPostReceipt, signal: AbortSignal) {
    const { video } = input(spec);
    return options.transport(spec).statuses(receipt, receipt.items.map((containerId, index) => ({ containerId, ...(video(index) ? { sizeBytes: spec.assets[index].sizeBytes } : {}) })), signal);
  }
  /** The carousel container is created inside the publishing fence; a deferral keeps its ID because nothing was published. */
  async function publishCarousel(spec: PublicationSpec, receipt: InstagramPostReceipt, signal: AbortSignal): Promise<RemoteObservation> {
    const { metadata } = input(spec), polls = receipt.carouselPolls ?? 0, t = options.transport(spec);
    const later = (next: InstagramPostReceipt) => new PublicationPublishError(polls + 1 >= CAROUSEL_DEFERRALS ? 'rejected' : 'unavailable', 30000, { ...next, carouselPolls: Math.min(CAROUSEL_DEFERRALS, polls + 1) });
    let current = receipt;
    try {
      if (!current.containerId) {
        const items = await statuses(spec, current, signal);
        if (items.some(failedStatus)) throw new PublicationPublishError('rejected', 0, { ...current, status: 'ERROR' });
        if (!items.every(item => item.status === 'FINISHED')) throw later(current);
        const caption = metadata.kind === 'carousel' ? metadata.caption : '';
        current = { ...current, containerId: await t.createCarousel(current, current.items, { caption, isAiGenerated: metadata.isAiGenerated }, signal), status: 'IN_PROGRESS' };
      }
      let container: InstagramContainer | undefined;
      for (let attempt = 0; attempt < CAROUSEL_WAITS; attempt++) {
        container = (await t.statuses(current, [{ containerId: current.containerId! }], signal))[0];
        if (container.status !== 'IN_PROGRESS') break;
        await wait(options.carouselWaitMs ?? 3000, signal);
      }
      if (container && failedStatus(container)) throw new PublicationPublishError('rejected', 0, { ...current, status: container.status });
      if (container?.status === 'PUBLISHED') return observed(current, container);
      if (container?.status !== 'FINISHED') throw later(current);
    } catch (error) {
      if (error instanceof PublicationPublishError) throw error;
      if (error instanceof InstagramTransportError && error.outcome === 'rejected') throw new PublicationPublishError('rejected', 0, current);
      // media_publish has not been called, so a lost reply here cannot have published anything.
      throw later(current);
    }
    try {
      const result = await t.publish({ containerId: current.containerId!, instagramId: current.instagramId, pageId: current.pageId, sizeBytes: 0, video: false, ...(metadata.publishAt ? { publishAt: metadata.publishAt } : {}) }, signal);
      return observed(current, result.container, result.mediaId);
    } catch (error) {
      if (error instanceof InstagramTransportError && error.outcome === 'unavailable') throw later(current);
      throw error;
    }
  }
  return {
    async prepare(spec: PublicationSpec, read: Read, signal: AbortSignal) {
      for (const [index, asset] of spec.assets.entries()) if (asset.contentType === 'image/jpeg') await options.host.publish(asset, () => read(index, 0, asset.sizeBytes), signal);
    },
    async start(spec: PublicationSpec, signal: AbortSignal): Promise<JsonValue> {
      let request: InstagramPostRequest;
      try {
        const { metadata } = input(spec), items: InstagramPostRequest['items'] = [];
        for (const [index, asset] of spec.assets.entries()) {
          if (asset.contentType === 'video/mp4') { items.push({ type: 'video' }); continue; }
          // Meta downloads during creation; never create a container for a link it cannot read.
          const url = await options.host.verify(asset, signal);
          if (!url) throw new PublicationStartError('unavailable');
          const altText = metadata.kind === 'image' ? metadata.altText : metadata.kind === 'carousel' ? metadata.altTexts?.[index] : undefined;
          items.push({ type: 'image', url, ...(altText ? { altText } : {}) });
        }
        request = { kind: metadata.kind as InstagramPostRequest['kind'], isAiGenerated: metadata.isAiGenerated, items,
          ...(metadata.kind === 'image' ? { caption: metadata.caption } : {}), ...(metadata.publishAt ? { publishAt: metadata.publishAt } : {}) };
      } catch (error) {
        // Nothing has been sent to Meta yet, so any failure here is safe to retry.
        if (error instanceof PublicationStartError) throw error;
        throw new PublicationStartError('unavailable');
      }
      try { return await options.transport(spec).createPost(input(spec).instagramId, request, signal); }
      catch (error) {
        if (error instanceof InstagramTransportError && error.outcome !== 'unknown') throw new PublicationStartError(error.outcome);
        throw error;
      }
    },
    async transfer(spec: PublicationSpec, raw: JsonValue, read: Read, signal: AbortSignal): Promise<TransferObservation> {
      const checkpoint = checkpointOf(spec, raw), index = pending(spec, checkpoint);
      if (index < 0) return accepted(spec, checkpoint);
      const item = checkpoint.items[index];
      const result = await options.transport(spec).upload({ containerId: item.containerId, instagramId: checkpoint.instagramId, pageId: checkpoint.pageId, sizeBytes: spec.assets[index].sizeBytes }, (offset, length) => read(index, offset, length), signal);
      return advance(spec, checkpoint, index, result);
    },
    /** Read-only: re-reads remote progress for the next unfinished video, never sends bytes. */
    async reconcile(spec: PublicationSpec, raw: JsonValue, signal: AbortSignal): Promise<TransferObservation> {
      const checkpoint = checkpointOf(spec, raw), index = pending(spec, checkpoint);
      if (index < 0) return accepted(spec, checkpoint);
      const [result] = await options.transport(spec).statuses(checkpoint, [{ containerId: checkpoint.items[index].containerId, sizeBytes: spec.assets[index].sizeBytes }], signal);
      return advance(spec, checkpoint, index, result);
    },
    async inspect(spec: PublicationSpec, raw: JsonValue, signal: AbortSignal): Promise<RemoteObservation> {
      const receipt = receiptOf(spec, raw);
      let observation: RemoteObservation, status: InstagramContainer['status'];
      if (receipt.containerId) {
        const [container] = await options.transport(spec).statuses(receipt, [{ containerId: receipt.containerId }], signal);
        observation = observed(receipt, container); status = container.status;
      } else {
        const items = await statuses(spec, receipt, signal);
        status = items.some(failedStatus) ? 'ERROR' : items.every(item => item.status === 'FINISHED') ? 'FINISHED' : 'IN_PROGRESS';
        observation = observed(receipt, { id: receipt.items[0], status });
      }
      const polls = status === 'IN_PROGRESS' ? Math.min(5, (receipt.processingPolls ?? 0) + 1) : receipt.processingPolls ?? 0;
      if (polls > 0) observation.receipt = { ...instagramPostReceiptSchema.parse(observation.receipt), processingPolls: polls };
      if (observation.state === 'processing' && polls >= 5) throw new PublicationInspectionPaused(observation.receipt);
      return observation;
    },
    async publish(spec: PublicationSpec, raw: JsonValue, signal: AbortSignal): Promise<RemoteObservation> {
      const receipt = receiptOf(spec, raw), { metadata } = input(spec);
      if (metadata.kind === 'carousel') return publishCarousel(spec, receipt, signal);
      try {
        const result = await options.transport(spec).publish({ containerId: receipt.containerId!, instagramId: receipt.instagramId, pageId: receipt.pageId, sizeBytes: 0, video: false, ...(metadata.publishAt ? { publishAt: metadata.publishAt } : {}) }, signal);
        return observed(receipt, result.container, result.mediaId);
      } catch (error) {
        if (error instanceof InstagramTransportError && error.outcome === 'unavailable') throw new PublicationPublishError('unavailable');
        throw error;
      }
    },
    mediaId: (spec: PublicationSpec, raw: JsonValue) => receiptOf(spec, raw).mediaId,
    target: (spec: PublicationSpec, raw: JsonValue) => receiptOf(spec, raw),
  };
}
