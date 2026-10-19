import { z } from 'zod';
import { youtubeMetadataSchema, youtubeResource, type YouTubeMetadata } from './youtube-contract';
import { boundedJson, parseReceipt, retryAfter, uploadResponse, uploadSessionUrl, YouTubeTransportError } from './youtube-http.server';

export const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024;
const base = 'https://www.googleapis.com';
const channelsSchema = z.object({ items: z.array(z.object({ id: z.string().min(1).max(128), snippet: z.object({ title: z.string().max(1000) }) })).max(50), nextPageToken: z.string().optional() });
type Options = { accessToken: (signal: AbortSignal) => Promise<string>; invalidateAccessToken?: (token: string) => Promise<void>; fetch?: typeof fetch; now?: () => number };
type UploadIdentity = { sessionUrl: string; channelId: string; sizeBytes: number; contentType: 'video/mp4' | 'video/webm' };
function size(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 256 * 1024 ** 3) throw new Error('Invalid YouTube upload byte size');
}
function channel(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid YouTube channel ID');
}

/** Transport only: callers must persist approval, session and receipt before advancing. */
export function createYouTubeTransport(options: Options) {
  const request = options.fetch ?? fetch, now = options.now ?? Date.now;
  async function authorization(signal: AbortSignal) {
    signal.throwIfAborted();
    const token = await options.accessToken(signal);
    if (!token || token.length > 8192 || /\s/.test(token)) throw new YouTubeTransportError('YouTube authorization is unavailable', 'unavailable');
    return token;
  }
  async function authorized(url: string, init: RequestInit, signal: AbortSignal, outcome: 'unknown' | 'unavailable' = 'unknown', pinnedToken?: string) {
    signal.throwIfAborted();
    const token = pinnedToken ?? await authorization(signal);
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    try {
      boundedSignal.throwIfAborted();
      const response = await request(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` }, redirect: 'manual', credentials: 'omit', signal: boundedSignal });
      if (response.status === 401 && options.invalidateAccessToken) {
        try { await options.invalidateAccessToken(token); }
        catch { await response.body?.cancel(); throw new YouTubeTransportError('YouTube credential invalidation is unavailable', init.method === 'POST' ? 'rejected' : 'unavailable'); }
      }
      return response;
    } catch (error) { if (error instanceof YouTubeTransportError) throw error; throw new YouTubeTransportError('YouTube request ended without a confirmed response', outcome); }
  }
  async function ownedChannels(signal: AbortSignal, pinnedToken?: string) {
    const response = await authorized(`${base}/youtube/v3/channels?part=snippet&mine=true&maxResults=50`, { method: 'GET' }, signal, 'unavailable', pinnedToken);
    if (!response.ok) { await response.body?.cancel(); throw new YouTubeTransportError(`YouTube account lookup failed (HTTP ${response.status})`, 'unavailable', response.status, retryAfter(response)); }
    const parsed = channelsSchema.safeParse(await boundedJson(response, signal));
    if (!parsed.success || parsed.data.nextPageToken) throw new YouTubeTransportError('YouTube account identity is incomplete', 'unavailable');
    return parsed.data.items.map(item => ({ id: item.id, title: item.snippet.title }));
  }
  return {
    ownedChannels,
    async startSession(input: { channelId: string; sizeBytes: number; contentType: UploadIdentity['contentType']; metadata: YouTubeMetadata }, signal: AbortSignal) {
      size(input.sizeBytes); channel(input.channelId);
      if (!['video/mp4', 'video/webm'].includes(input.contentType)) throw new Error('Unsupported upload content type');
      const metadata = youtubeMetadataSchema.parse(input.metadata); youtubeResource(metadata, now());
      const pinnedToken = await authorization(signal);
      const accounts = await ownedChannels(signal, pinnedToken);
      // Standard OAuth inserts into its authenticated channel; CMS routing is a separate contract.
      if (accounts.length !== 1 || accounts[0].id !== input.channelId) throw new YouTubeTransportError('The connected OAuth channel does not uniquely match the selected destination', 'rejected');
      const resource = youtubeResource(metadata, now());
      const response = await authorized(`${base}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${metadata.notifySubscribers}`, {
        method: 'POST', headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(input.sizeBytes), 'x-upload-content-type': input.contentType }, body: JSON.stringify(resource),
      }, signal, 'unknown', pinnedToken);
      await response.body?.cancel();
      if (response.status !== 200 && response.status !== 201) {
        const rejected = [400, 401, 403, 404, 413, 415, 422].includes(response.status);
        throw new YouTubeTransportError(`YouTube session creation failed (HTTP ${response.status})`, rejected ? 'rejected' : 'unknown', response.status, retryAfter(response));
      }
      return { sessionUrl: uploadSessionUrl(response.headers.get('location') ?? '') };
    },
    async probe(identity: UploadIdentity, signal: AbortSignal) {
      size(identity.sizeBytes); channel(identity.channelId);
      if (!['video/mp4', 'video/webm'].includes(identity.contentType)) throw new Error('Unsupported upload content type');
      const response = await authorized(uploadSessionUrl(identity.sessionUrl), { method: 'PUT', headers: { 'content-length': '0', 'content-range': `bytes */${identity.sizeBytes}` }, body: new Uint8Array() }, signal);
      return uploadResponse(response, identity.channelId, identity.sizeBytes, signal);
    },
    async sendChunk(identity: UploadIdentity, offset: number, bytes: Uint8Array, signal: AbortSignal) {
      size(identity.sizeBytes); channel(identity.channelId);
      if (!['video/mp4', 'video/webm'].includes(identity.contentType)) throw new Error('Unsupported upload content type');
      const end = offset + bytes.length;
      if (!Number.isSafeInteger(offset) || offset < 0 || bytes.length < 1 || bytes.length > YOUTUBE_CHUNK_BYTES || end > identity.sizeBytes || (end < identity.sizeBytes && bytes.length !== YOUTUBE_CHUNK_BYTES)) throw new Error('Invalid upload chunk; use the fixed chunk size except for the final chunk');
      const response = await authorized(uploadSessionUrl(identity.sessionUrl), { method: 'PUT', headers: {
        'content-type': identity.contentType, 'content-length': String(bytes.length), 'content-range': `bytes ${offset}-${end - 1}/${identity.sizeBytes}`,
      }, body: new Uint8Array(bytes) }, signal);
      return uploadResponse(response, identity.channelId, identity.sizeBytes, signal, end);
    },
    async inspectVideo(videoId: string, channelId: string, signal: AbortSignal) {
      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID'); channel(channelId);
      const response = await authorized(`${base}/youtube/v3/videos?part=snippet,status,processingDetails&id=${videoId}`, { method: 'GET' }, signal, 'unavailable');
      if (!response.ok) { await response.body?.cancel(); throw new YouTubeTransportError(`YouTube video lookup failed (HTTP ${response.status})`, 'unavailable', response.status); }
      const result = z.object({ items: z.array(z.unknown()).max(1) }).safeParse(await boundedJson(response, signal));
      if (!result.success || result.data.items.length !== 1) throw new YouTubeTransportError('The uploaded video is not yet verifiable', 'unknown');
      const receipt = parseReceipt(result.data.items[0], channelId);
      if (receipt.videoId !== videoId) throw new YouTubeTransportError('YouTube returned another video; reconcile the original receipt', 'unknown');
      return receipt;
    },
  };
}
