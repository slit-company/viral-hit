import { z } from 'zod';

/** Hosts Meta uses for message attachments and shared media. Every redirect is checked again by the downloader. */
export function inboxMediaUrl(raw: string): URL {
  if (raw.length > 16000 || /[\x00-\x20\x7f\\]/u.test(raw)) throw new Error('Invalid Instagram media URL');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid Instagram media URL'); }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || !(host === 'lookaside.fbsbx.com' || /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:cdninstagram\.com|fbcdn\.net)$/.test(host))) {
    throw new Error('Instagram media requires an approved HTTPS CDN');
  }
  return url;
}

const graphId = z.string().regex(/^[A-Za-z0-9_.:=+/-]{1,512}$/), time = z.string().max(40);
export const inboxConversationsSchema = z.object({
  data: z.array(z.object({ id: graphId, updated_time: time.optional() }).passthrough()).max(100),
  paging: z.object({ next: z.string().optional(), cursors: z.object({ after: z.string().max(4096).regex(/^[a-zA-Z0-9_=+-]+$/).optional() }).passthrough().optional() }).passthrough().optional(),
}).passthrough();
const message = z.object({
  id: graphId, created_time: time.optional(),
  from: z.object({ id: z.string().max(64), username: z.string().max(200).optional() }).passthrough().optional(),
  attachments: z.object({ data: z.array(z.object({ video_data: z.object({ url: z.string().max(16000) }).passthrough().optional() }).passthrough()).max(30) }).passthrough().optional(),
  shares: z.object({ data: z.array(z.object({ type: z.string().max(40).optional(), url: z.string().max(16000).optional(), link: z.string().max(16000).optional() }).passthrough()).max(30) }).passthrough().optional(),
}).passthrough();
export const inboxConversationSchema = z.object({ id: graphId, messages: z.object({ data: z.array(message).max(20) }).passthrough().optional() }).passthrough();

export type InboxVideo = { conversationId: string; messageId: string; index: number; kind: 'video' | 'reel'; url: string; senderId: string; senderUsername: string | null; sentAt: number | null };
export type InboxOutcome = 'ok' | 'permission-missing' | 'reconnect' | 'unavailable' | 'no-project';
export type InboxSettings = { projectId: string; enabled: boolean; revision: number; updatedAt: number };
export type InboxCheck = { checkedAt: number | null; outcome: InboxOutcome | null; imported: number; failed: number; requestedAt: number | null; nextCheckAt: number | null };
export type InboxItem = { messageId: string; index: number; kind: InboxVideo['kind']; senderUsername: string | null; sentAt: number | null; status: 'imported' | 'failed'; assetId: string | null; attempts: number; updatedAt: number };
/** What HTTP, MCP and the Connections screen see for one account. */
export type InboxView = { accountId: string; username: string; connected: boolean; settings: InboxSettings | null; check: InboxCheck; recent: InboxItem[] };
/** Graph times look like 2026-11-03T01:02:03+0000. */
export function graphTime(value?: string) {
  if (!value) return null;
  const parsed = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Videos other people sent: direct video attachments and shared Reels. The account's own messages, images,
 * shared posts and links outside Meta's media hosts are ignored. Message text is never read.
 */
export function inboxVideos(raw: unknown, instagramId: string): InboxVideo[] {
  const conversation = inboxConversationSchema.parse(raw), videos: InboxVideo[] = [];
  for (const item of conversation.messages?.data ?? []) {
    const sender = item.from;
    if (!sender || sender.id === instagramId) continue;
    const add = (index: number, kind: InboxVideo['kind'], url?: string) => {
      if (!url) return;
      try { inboxMediaUrl(url); } catch { return; }
      videos.push({ conversationId: conversation.id, messageId: item.id, index, kind, url, senderId: sender.id, senderUsername: sender.username ?? null, sentAt: graphTime(item.created_time) });
    };
    (item.attachments?.data ?? []).forEach((attachment, index) => add(index, 'video', attachment.video_data?.url));
    (item.shares?.data ?? []).forEach((share, index) => { if (share.type === 'reel' || share.type === 'ig_reel') add(100 + index, 'reel', share.url ?? share.link); });
  }
  return videos;
}
