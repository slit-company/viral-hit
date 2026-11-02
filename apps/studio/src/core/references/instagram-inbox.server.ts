import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { getActiveProject } from '../projects/projects';
import { downloadMedia } from '../harness/download-media';
import { instagramJson, InstagramTransportError } from '../publishing/instagram-http.server';
import { INSTAGRAM_GRAPH_VERSION, type InstagramCredential } from '../publishing/instagram-transport.server';
import { acquireVideoReference } from './intake.server';
import { REFERENCE_MAX_BYTES } from './reference-assets.server';
import { graphTime, inboxConversationsSchema, inboxMediaUrl, inboxVideos, type InboxVideo } from './instagram-inbox-contract';
import type { InboxOutcome, InstagramInboxStore } from './instagram-inbox-store.server';

// Meta returns details only for the 20 most recent messages of a conversation.
const MESSAGE_FIELDS = 'messages.limit(20){id,created_time,from,attachments{video_data},shares{type,url,link}}';
const MAX_CONVERSATIONS = 40, MAX_IMPORTS = 5, MAX_ATTEMPTS = 3, FIRST_LOOKBACK_MS = 7 * 86_400_000, OVERLAP_MS = 10 * 60_000;
export class InboxAccessError extends Error {
  constructor(readonly outcome: Exclude<InboxOutcome, 'ok' | 'no-project'>) { super('Instagram messages could not be read'); }
}
export type InboxDependencies = {
  store: InstagramInboxStore;
  credential: (accountId: string, signal: AbortSignal) => Promise<InstagramCredential>;
  invalidate?: (accountId: string, credential: InstagramCredential) => Promise<void> | void;
  fetch?: typeof fetch; download?: (url: string, file: string, signal: AbortSignal) => Promise<void>; now?: () => number;
};

/** Official Conversations API with the Page token; never follows provider paging URLs and never reads message text. */
export async function readInstagramInbox(credential: InstagramCredential, since: number, signal: AbortSignal, request: typeof fetch = fetch) {
  async function get(path: string, params: Record<string, string>) {
    const url = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${path}`); url.search = new URLSearchParams(params).toString();
    try { return await instagramJson(await request(url.href, { method: 'GET', redirect: 'error', signal, headers: { authorization: `Bearer ${credential.accessToken}` } }), signal); }
    catch (error) {
      signal.throwIfAborted();
      const code = error instanceof InstagramTransportError ? error.graphCode : undefined;
      if (code === 190) throw new InboxAccessError('reconnect');
      if ((code !== undefined && [3, 10, 200, 230].includes(code)) || (error instanceof InstagramTransportError && error.httpStatus === 403)) throw new InboxAccessError('permission-missing');
      throw new InboxAccessError('unavailable');
    }
  }
  const conversations: string[] = []; let after: string | undefined;
  for (let page = 0; page < 2 && conversations.length < MAX_CONVERSATIONS; page++) {
    const batch = inboxConversationsSchema.parse(await get(`${credential.pageId}/conversations`, { platform: 'instagram', fields: 'id,updated_time', limit: '25', ...(after ? { after } : {}) }));
    let older = false;
    for (const item of batch.data) {
      const updated = graphTime(item.updated_time);
      if (updated !== null && updated < since) { older = true; break; }
      conversations.push(item.id);
    }
    after = batch.paging?.cursors?.after;
    if (older || !after || !batch.paging?.next) break;
  }
  const videos: InboxVideo[] = [];
  for (const id of conversations.slice(0, MAX_CONVERSATIONS)) videos.push(...inboxVideos(await get(encodeURIComponent(id), { fields: MESSAGE_FIELDS }), credential.instagramId));
  return videos.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
}
const sourceKey = (instagramId: string, video: InboxVideo) => createHash('sha256').update(JSON.stringify(['instagram-inbox', instagramId, video.conversationId, video.messageId, video.index])).digest('hex');
const download = (url: string, file: string, signal: AbortSignal) => downloadMedia(url, file, signal, REFERENCE_MAX_BYTES, inboxMediaUrl);

/**
 * One check for one account: new videos become project references (original plus sampled frames). At most five
 * imports per check; a failing item is retried on later checks up to three attempts. Every check is recorded.
 */
export async function collectInstagramInbox(accountId: string, deps: InboxDependencies, signal: AbortSignal) {
  const settings = deps.store.settings(accountId), finish = (outcome: InboxOutcome, imported = 0, failed = 0) => {
    deps.store.finishCheck(accountId, outcome, imported, failed); return { outcome, imported, failed };
  };
  if (!settings || !await getActiveProject({ projectId: settings.projectId })) return finish('no-project');
  let credential: InstagramCredential;
  try { credential = await deps.credential(accountId, signal); }
  catch { signal.throwIfAborted(); return finish('reconnect'); }
  const now = (deps.now ?? Date.now)(), since = (deps.store.lastSuccess(accountId) ?? now - FIRST_LOOKBACK_MS) - OVERLAP_MS;
  let videos: InboxVideo[];
  try { videos = await readInstagramInbox(credential, since, signal, deps.fetch); }
  catch (error) {
    signal.throwIfAborted();
    const outcome = error instanceof InboxAccessError ? error.outcome : 'unavailable';
    if (outcome === 'reconnect') await deps.invalidate?.(accountId, credential);
    return finish(outcome);
  }
  let imported = 0, failed = 0;
  for (const video of videos) {
    if (imported + failed >= MAX_IMPORTS) break;
    const prior = deps.store.item(accountId, video.messageId, video.index);
    if (prior?.status === 'imported' || (prior && prior.attempts >= MAX_ATTEMPTS)) continue;
    try {
      const result = await acquireVideoReference({ projectId: settings.projectId, source: 'instagram-direct', sourceKey: sourceKey(credential.instagramId, video), signal,
        acquire: (file, acquireSignal) => (deps.download ?? download)(video.url, file, acquireSignal) });
      deps.store.recordItem(accountId, video, 'imported', result.original.assetId); imported++;
    } catch {
      signal.throwIfAborted();
      deps.store.recordItem(accountId, video, 'failed', null); failed++;
    }
  }
  return finish('ok', imported, failed);
}

/** Runs beside the publication worker: requested checks first, then enabled accounts every interval. */
export async function runInstagramInboxLoop(signal: AbortSignal, open: () => { deps: InboxDependencies; close: () => void } | null, intervalMs = 30_000) {
  while (!signal.aborted) {
    try {
      const session = open();
      if (session) {
        try { for (const accountId of session.deps.store.due()) { signal.throwIfAborted(); await collectInstagramInbox(accountId, session.deps, signal); } }
        finally { session.close(); }
      }
    } catch { if (!signal.aborted) console.error('Instagram inbox check failed; it will retry.'); }
    await sleep(intervalMs, undefined, { signal }).catch(() => undefined);
  }
}
