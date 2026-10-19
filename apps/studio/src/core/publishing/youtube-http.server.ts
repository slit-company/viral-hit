import { z } from 'zod';
import type { YouTubeReceipt, YouTubeUploadResult } from './youtube-contract';

export class YouTubeTransportError extends Error {
  constructor(message: string, readonly outcome: 'rejected' | 'unknown' | 'unavailable', readonly status?: number, readonly retryAfterMs: number | null = null) { super(message); }
}

export function uploadSessionUrl(raw: string) {
  if (raw.length > 8192) throw new YouTubeTransportError('YouTube upload session URL exceeds its size limit', 'unknown');
  let url: URL;
  try { url = new URL(raw); } catch { throw new YouTubeTransportError('YouTube returned an invalid upload session URL', 'unknown'); }
  if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || (url.port && url.port !== '443') || url.username || url.password || url.hash || url.pathname !== '/upload/youtube/v3/videos' || !url.searchParams.get('upload_id')) {
    throw new YouTubeTransportError('YouTube upload session is not an expected Google endpoint', 'unknown');
  }
  return url.href;
}

export function retryAfter(response: Response, now = Date.now()): number | null {
  const raw = response.headers.get('retry-after'); if (!raw) return null;
  const value = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 86_400_000)) : null;
}

export async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new YouTubeTransportError('YouTube response is empty', 'unknown', response.status);
  const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 64 * 1024) throw new YouTubeTransportError('YouTube response exceeds its byte limit', 'unknown', response.status);
      chunks.push(value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new YouTubeTransportError('YouTube returned invalid JSON', 'unknown', response.status); }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

const receiptSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
  snippet: z.object({ channelId: z.string().min(1).max(128) }),
  status: z.object({ privacyStatus: z.enum(['private', 'unlisted', 'public']), uploadStatus: z.enum(['uploaded', 'processed', 'failed', 'rejected', 'deleted']), publishAt: z.string().optional() }),
  processingDetails: z.object({ processingStatus: z.enum(['processing', 'succeeded', 'failed', 'terminated']) }).optional(),
});
export function parseReceipt(raw: unknown, channelId: string): YouTubeReceipt {
  const result = receiptSchema.safeParse(raw);
  if (!result.success) throw new YouTubeTransportError('YouTube did not return a verifiable video receipt', 'unknown');
  const video = result.data;
  if (video.snippet.channelId !== channelId) throw new YouTubeTransportError('YouTube receipt belongs to another channel; reconcile before any retry', 'unknown');
  return { videoId: video.id, channelId, privacy: video.status.privacyStatus, uploadStatus: video.status.uploadStatus,
    ...(video.status.publishAt ? { publishAt: video.status.publishAt } : {}),
    ...(video.processingDetails ? { processingStatus: video.processingDetails.processingStatus } : {}) };
}

export async function uploadResponse(response: Response, channelId: string, total: number, signal: AbortSignal, maxAcknowledged = total): Promise<YouTubeUploadResult> {
  if (response.status === 308) {
    const range = response.headers.get('range');
    const match = range === null ? null : /^bytes=0-(\d+)$/.exec(range);
    const nextByte = range === null ? 0 : match ? Number(match[1]) + 1 : NaN;
    await response.body?.cancel();
    if (!Number.isSafeInteger(nextByte) || nextByte < 0 || nextByte > Math.min(total, maxAcknowledged)) throw new YouTubeTransportError('YouTube reported an inconsistent byte acknowledgement', 'unknown', 308);
    return { kind: 'incomplete', nextByte, retryAfterMs: retryAfter(response) };
  }
  if (response.status === 200 || response.status === 201) return { kind: 'accepted', receipt: parseReceipt(await boundedJson(response, signal), channelId) };
  await response.body?.cancel();
  if (response.status === 404 || response.status === 410) return { kind: 'expired' };
  throw new YouTubeTransportError(`YouTube upload response HTTP ${response.status}; inspect the existing session before retrying`, 'unknown', response.status, retryAfter(response));
}
