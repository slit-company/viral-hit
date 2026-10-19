import { z } from 'zod';
import { PublicationAssetError, PublicationStartError, type PublicationConnector, type PublicationSpec, type TransferObservation } from './contracts';
import type { JsonValue } from '../../lib/canonical-json';
import { youtubeMetadataSchema, youtubeResource, type YouTubeUploadResult } from './youtube-contract';
import { uploadSessionUrl, YouTubeTransportError } from './youtube-http.server';
import { createYouTubeTransport, YOUTUBE_CHUNK_BYTES } from './youtube-transport.server';

export const YOUTUBE_CONNECTOR_VERSION = '1';
const checkpointSchema = z.object({ sessionUrl: z.string(), nextByte: z.number().int().nonnegative() }).strict();
const receiptIdentitySchema = z.object({ videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/), channelId: z.string() });
type Options = { accessToken: (accountId: string, signal: AbortSignal) => Promise<string>; invalidateAccessToken?: (accountId: string, token: string) => Promise<void>; fetch?: typeof fetch; now?: () => number };

export function validateYouTubePublication(spec: PublicationSpec) {
  if (spec.connector !== 'youtube' || spec.connectorVersion !== YOUTUBE_CONNECTOR_VERSION) throw new Error('Unsupported YouTube connector version');
  if (spec.assets.length !== 1) throw new Error('YouTube requires exactly one video export');
  const asset = spec.assets[0], contentType = z.enum(['video/mp4', 'video/webm']).parse(asset.contentType);
  return { channelId: spec.destinationId, sizeBytes: asset.sizeBytes, contentType, metadata: youtubeMetadataSchema.parse(spec.metadata) };
}

export function createYouTubeConnector(options: Options): PublicationConnector {
  const transport = (spec: PublicationSpec) => createYouTubeTransport({
    accessToken: signal => options.accessToken(spec.accountId, signal),
    invalidateAccessToken: token => options.invalidateAccessToken?.(spec.accountId, token) ?? Promise.resolve(), fetch: options.fetch, now: options.now,
  });
  function identity(spec: PublicationSpec, raw: JsonValue) {
    const input = validateYouTubePublication(spec), checkpoint = checkpointSchema.parse(raw);
    if (checkpoint.nextByte > input.sizeBytes) throw new Error('Invalid YouTube checkpoint');
    return { ...input, sessionUrl: uploadSessionUrl(checkpoint.sessionUrl) };
  }
  function observation(result: YouTubeUploadResult, sessionUrl: string): TransferObservation {
    if (result.kind === 'accepted') return result;
    if (result.kind === 'expired') return { kind: 'uncertain', issue: 'session-expired' };
    return { kind: 'progress', checkpoint: { sessionUrl, nextByte: result.nextByte }, retryAfterMs: result.retryAfterMs ?? 0 };
  }
  return {
    id: 'youtube', version: YOUTUBE_CONNECTOR_VERSION,
    async start(spec, signal) {
      let input: ReturnType<typeof validateYouTubePublication>;
      try { input = validateYouTubePublication(spec); youtubeResource(input.metadata, (options.now ?? Date.now)()); }
      catch { throw new PublicationStartError('rejected'); }
      try {
        const session = await transport(spec).startSession(input, signal);
        return { ...session, nextByte: 0 };
      } catch (error) {
        if (error instanceof YouTubeTransportError && error.outcome !== 'unknown') throw new PublicationStartError(error.outcome, error.retryAfterMs ?? 30000);
        throw error;
      }
    },
    async transfer(spec, checkpoint, read, signal) {
      const target = identity(spec, checkpoint), client = transport(spec);
      const probe = await client.probe(target, signal);
      if (probe.kind !== 'incomplete') return observation(probe, target.sessionUrl);
      // Respect provider backoff; all bytes may be accepted before a receipt is available.
      if (probe.nextByte === target.sizeBytes || (probe.retryAfterMs ?? 0) > 0) {
        return { kind: 'progress', checkpoint: { sessionUrl: target.sessionUrl, nextByte: probe.nextByte }, retryAfterMs: probe.retryAfterMs || 30000 };
      }
      const length = Math.min(YOUTUBE_CHUNK_BYTES, target.sizeBytes - probe.nextByte);
      const bytes = await read(0, probe.nextByte, length);
      if (bytes.length !== length) throw new PublicationAssetError();
      signal.throwIfAborted();
      return observation(await client.sendChunk(target, probe.nextByte, bytes, signal), target.sessionUrl);
    },
    async reconcile(spec, checkpoint, signal) {
      const target = identity(spec, checkpoint);
      return observation(await transport(spec).probe(target, signal), target.sessionUrl);
    },
    async inspect(spec, raw, signal) {
      validateYouTubePublication(spec);
      const identity = receiptIdentitySchema.parse(raw);
      if (identity.channelId !== spec.destinationId) throw new Error('Receipt belongs to another destination');
      const receipt = await transport(spec).inspectVideo(identity.videoId, spec.destinationId, signal);
      if (['failed', 'rejected', 'deleted'].includes(receipt.uploadStatus) || ['failed', 'terminated'].includes(receipt.processingStatus ?? '')) return { state: 'failed', receipt };
      if (receipt.uploadStatus !== 'processed' || receipt.processingStatus === 'processing') return { state: 'processing', receipt, retryAfterMs: 30000 };
      if (receipt.privacy === 'public') return { state: 'published', receipt };
      if (receipt.privacy === 'private' && receipt.publishAt) return { state: 'scheduled', receipt, retryAfterMs: 60000 };
      return { state: 'ready', receipt };
    },
  };
}
