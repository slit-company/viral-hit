import { z } from 'zod';
import { instagramNotBefore } from './instagram-schedule';
import { PublicationAssetError, PublicationDeferred } from './contracts';
import { instagramIdSchema, type InstagramContainer, type InstagramMetadata } from './instagram-contract';
import { instagramJson, InstagramTransportError } from './instagram-http.server';

export type InstagramCredential = { pageId: string; instagramId: string; accessToken: string; revision?: number };
type Options = { credential: (signal: AbortSignal) => Promise<InstagramCredential>; fetch?: typeof fetch; invalidateCredential?: (credential: InstagramCredential) => Promise<void> };
// Pinned protocol revision, not an implicit latest version. Changes require a connector version bump.
export const INSTAGRAM_GRAPH_VERSION = 'v26.0';
export const INSTAGRAM_READ_BYTES = 8 * 1024 * 1024;
const credentialSchema = z.object({ pageId: instagramIdSchema, instagramId: instagramIdSchema, accessToken: z.string().min(1).max(16384).regex(/^[^\r\n]+$/), revision: z.number().int().positive().optional() });
const pageSchema = z.object({ id: instagramIdSchema, instagram_business_account: z.object({ id: instagramIdSchema }) });
const containerSchema = z.object({
  id: instagramIdSchema, status_code: z.enum(['IN_PROGRESS', 'FINISHED', 'PUBLISHED', 'ERROR', 'EXPIRED']),
  video_status: z.object({ uploading_phase: z.object({
    status: z.enum(['not_started', 'in_progress', 'complete', 'error']), bytes_transferred: z.number().int().nonnegative(),
  }).optional() }).optional(),
});
const idResponse = z.object({ id: instagramIdSchema });
const graph = (path: string) => `https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${path}`;
const uploadUrl = (id: string) => `https://rupload.facebook.com/ig-api-upload/${INSTAGRAM_GRAPH_VERSION}/${instagramIdSchema.parse(id)}`;

function enforceTime(metadata: { publishAt?: string }, phase: 'start' | 'publish') {
  const until = instagramNotBefore(metadata, phase);
  if (until !== null && Date.now() < until) throw new PublicationDeferred(until);
}
export function createInstagramTransport(options: Options) {
  const request = options.fetch ?? fetch;
  async function json(url: string, credential: InstagramCredential, signal: AbortSignal, body?: Record<string, unknown>) {
    signal.throwIfAborted();
    try {
      return await instagramJson(await request(url, {
        method: body ? 'POST' : 'GET', signal, redirect: 'error',
        headers: { authorization: `Bearer ${credential.accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }), signal);
    } catch (error) {
      if (error instanceof InstagramTransportError && error.credentialRejected) await options.invalidateCredential?.(credential);
      throw new InstagramTransportError('unknown');
    }
  }
  /** Pin one credential across the identity check and its subsequent write. */
  async function authorize(instagramId: string, pageId: string | undefined, signal: AbortSignal) {
    try {
      const credential = credentialSchema.parse(await options.credential(signal));
      if (credential.instagramId !== instagramId || (pageId && credential.pageId !== pageId)) throw new Error('Account changed');
      const page = pageSchema.parse(await json(graph(`${credential.pageId}?fields=id,instagram_business_account`), credential, signal));
      if (page.id !== credential.pageId || page.instagram_business_account.id !== instagramId) throw new Error('Destination changed');
      signal.throwIfAborted(); return credential;
    } catch { throw new InstagramTransportError('unavailable'); }
  }
  async function statusWith(credential: InstagramCredential, id: string, sizeBytes: number, signal: AbortSignal): Promise<InstagramContainer> {
    const result = containerSchema.parse(await json(graph(`${instagramIdSchema.parse(id)}?fields=id,status_code,video_status`), credential, signal));
    if (result.id !== id) throw new InstagramTransportError('unknown');
    const upload = result.video_status?.uploading_phase;
    if (upload && (upload.bytes_transferred > sizeBytes || (upload.status === 'complete' && upload.bytes_transferred !== sizeBytes))) throw new InstagramTransportError('unknown');
    // The official guide contains an interrupted-upload example labelled PUBLISHED.
    // Inconsistent phase evidence must not be promoted to a successful receipt.
    if (['FINISHED', 'PUBLISHED'].includes(result.status_code) && upload && upload.status !== 'complete') throw new InstagramTransportError('unknown');
    return { id, status: result.status_code, ...(upload ? { upload: { status: upload.status, bytesTransferred: upload.bytes_transferred } } : {}) };
  }
  return {
    async create(instagramId: string, metadata: InstagramMetadata, signal: AbortSignal) {
      enforceTime(metadata, 'start');
      const credential = await authorize(instagramId, undefined, signal);
      enforceTime(metadata, 'start');
      const raw = await json(graph(`${instagramIdSchema.parse(instagramId)}/media`), credential, signal, {
        media_type: metadata.kind === 'reel' ? 'REELS' : 'STORIES', upload_type: 'resumable',
        is_ai_generated: metadata.isAiGenerated, ...(metadata.kind === 'reel' ? { caption: metadata.caption } : {}),
      });
      const result = idResponse.extend({ uri: z.string() }).parse(raw);
      // Never forward a bearer token to a provider-controlled response URL.
      if (result.uri !== uploadUrl(result.id)) throw new InstagramTransportError('unknown');
      return { containerId: result.id, instagramId, pageId: credential.pageId, nextByte: 0 };
    },
    async status(target: { containerId: string; instagramId: string; pageId: string; sizeBytes: number }, signal: AbortSignal) {
      return statusWith(await authorize(target.instagramId, target.pageId, signal), target.containerId, target.sizeBytes, signal);
    },
    async upload(target: { containerId: string; instagramId: string; pageId: string; sizeBytes: number }, read: (offset: number, length: number) => Promise<Uint8Array>, signal: AbortSignal) {
      const credential = await authorize(target.instagramId, target.pageId, signal);
      const before = await statusWith(credential, target.containerId, target.sizeBytes, signal);
      if (before.status !== 'IN_PROGRESS' || before.upload?.status === 'complete' || before.upload?.status === 'error') return before;
      if (!before.upload || before.upload.bytesTransferred === target.sizeBytes) return before;
      let offset = before.upload.bytesTransferred, stopped = false;
      // Stream remaining bytes with bounded integrity-checked reads. Resume only from a new remote probe.
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            signal.throwIfAborted();
            if (stopped) return;
            if (offset === target.sizeBytes) { controller.close(); return; }
            const length = Math.min(INSTAGRAM_READ_BYTES, target.sizeBytes - offset);
            const bytes = await read(offset, length);
            signal.throwIfAborted(); if (stopped) return;
            if (bytes.byteLength !== length) throw new PublicationAssetError();
            offset += length; controller.enqueue(bytes);
          } catch (error) { if (!stopped) controller.error(error); }
        },
        cancel() { stopped = true; },
      }, { highWaterMark: 0 });
      const init: RequestInit & { duplex: 'half' } = {
        method: 'POST', redirect: 'error', signal, duplex: 'half', body,
        headers: { authorization: `OAuth ${credential.accessToken}`, offset: String(offset), file_size: String(target.sizeBytes),
          'content-type': 'application/octet-stream', 'content-length': String(target.sizeBytes - offset) },
      };
      try {
        const result = z.object({ success: z.literal(true) }).parse(await instagramJson(await request(uploadUrl(target.containerId), init), signal));
        if (!result.success) throw new InstagramTransportError('unknown');
        return await statusWith(credential, target.containerId, target.sizeBytes, signal);
      } catch (error) {
        if (error instanceof InstagramTransportError && error.credentialRejected) await options.invalidateCredential?.(credential);
        throw new InstagramTransportError('unknown');
      }
      finally { stopped = true; if (!body.locked) await body.cancel().catch(() => undefined); }
    },
    /** Read-only insights for a published media ID. Requires the optional instagram_manage_insights permission. */
    async insights(target: { instagramId: string; pageId: string }, mediaId: string, metrics: readonly string[], signal: AbortSignal) {
      const credential = await authorize(target.instagramId, target.pageId, signal);
      return json(graph(`${instagramIdSchema.parse(mediaId)}/insights?metric=${metrics.map(name => encodeURIComponent(name)).join(',')}`), credential, signal);
    },
    async publish(target: { containerId: string; instagramId: string; pageId: string; sizeBytes: number; publishAt?: string }, signal: AbortSignal) {
      const credential = await authorize(target.instagramId, target.pageId, signal);
      let before: InstagramContainer;
      try { before = await statusWith(credential, target.containerId, target.sizeBytes, signal); }
      catch { throw new InstagramTransportError('unavailable'); }
      if (before.status !== 'FINISHED') return { container: before };
      enforceTime(target, 'publish');
      const media = idResponse.parse(await json(graph(`${target.instagramId}/media_publish`), credential, signal, { creation_id: target.containerId }));
      return { container: { ...before, status: 'PUBLISHED' as const }, mediaId: media.id };
    },
  };
}
