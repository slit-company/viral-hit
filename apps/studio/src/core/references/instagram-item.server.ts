import { createHash } from 'node:crypto';
import { z } from 'zod';

const identity = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const instagramItemRequest = z.object({
  accountId: identity, threadId: identity, itemId: identity, senderId: identity,
  item: z.unknown(),
}).strict();

export function instagramMediaUrl(raw: string): URL {
  if (raw.length > 16000 || /[\x00-\x20\x7f\\]/u.test(raw)) throw new Error('Invalid Instagram media URL');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid Instagram media URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)) {
    throw new Error('Instagram media requires an approved HTTPS CDN');
  }
  return url;
}

const rawItem = z.object({
  item_id: identity, user_id: z.union([identity, z.number().int().positive().safe()]).transform(String),
  item_type: z.literal('media'),
  media: z.object({
    media_type: z.literal(2),
    video_versions: z.array(z.object({
      url: z.string().min(1).max(16000), width: z.number().int().positive().max(16384), height: z.number().int().positive().max(16384),
    })).min(1).max(32),
  }),
});

/** Parses one explicitly supplied raw item. This does not authenticate a session or read an inbox. */
export function selectInstagramVideo(raw: unknown) {
  const envelope = instagramItemRequest.safeParse(raw);
  if (!envelope.success) throw new Error('Invalid Instagram item request');
  const parsed = rawItem.safeParse(envelope.data.item);
  if (!parsed.success) throw new Error('A direct video item with video_versions is required; a shared preview is insufficient');
  const item = parsed.data;
  if (item.item_id !== envelope.data.itemId || item.user_id !== envelope.data.senderId) throw new Error('Instagram item identity mismatch');
  const candidates = item.media.video_versions.filter(v => v.width * v.height <= 16_777_216)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  if (!candidates.length) throw new Error('No supported Instagram video rendition');
  // Validate every advertised rendition rather than silently selecting around an invalid one.
  for (const candidate of candidates) instagramMediaUrl(candidate.url);
  const sourceKey = createHash('sha256').update(JSON.stringify(['instagram-direct', envelope.data.accountId,
    envelope.data.threadId, item.item_id, item.user_id])).digest('hex');
  return { sourceKey, url: candidates[0].url };
}
