import { z } from 'zod';
import { getActiveProject } from '../projects/projects';
import { openInstagramAccountManagement, openInstagramAccounts } from '../publishing/instagram-accounts.server';
import { InstagramInboxStore } from './instagram-inbox-store.server';
import type { InboxView } from './instagram-inbox-contract';
import { collectInstagramInbox, type InboxDependencies } from './instagram-inbox.server';

export const inboxRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('configure'), accountId: z.uuid(), projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), enabled: z.boolean(), expectedRevision: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal('check'), accountId: z.uuid() }).strict(),
]);
export class InboxRequestError extends Error {
  constructor(readonly code: 'not-found' | 'conflict' | 'invalid-input', message: string) { super(message); }
}
const view = (store: InstagramInboxStore, account: { id: string; username: string; status: string }): InboxView => ({
  accountId: account.id, username: account.username, connected: account.status === 'connected',
  settings: store.settings(account.id), check: store.check(account.id), recent: store.recent(account.id),
});

/** Shared by HTTP, MCP and CLI. Ids, outcomes and sender usernames only; no tokens, URLs or message text. */
export function inboxOverview() {
  const accounts = openInstagramAccountManagement(), store = new InstagramInboxStore();
  try { return { inboxes: accounts.list().filter(account => account.status !== 'disconnected').map(account => view(store, account)) }; }
  finally { store.close(); accounts.close(); }
}
export async function changeInbox(raw: unknown) {
  const parsed = inboxRequest.safeParse(raw);
  if (!parsed.success) throw new InboxRequestError('invalid-input', 'Invalid inbox request');
  const input = parsed.data, accounts = openInstagramAccountManagement(), store = new InstagramInboxStore();
  try {
    const account = accounts.get(input.accountId);
    if (!account || account.status === 'disconnected') throw new InboxRequestError('not-found', 'Connect this Instagram account first');
    if (input.action === 'configure') {
      if (!await getActiveProject({ projectId: input.projectId })) throw new InboxRequestError('not-found', 'Project not found');
      try { store.configure(input.accountId, { projectId: input.projectId, enabled: input.enabled }, input.expectedRevision); }
      catch { throw new InboxRequestError('conflict', 'Inbox settings changed; refresh and try again'); }
    } else {
      if (!store.settings(input.accountId)) throw new InboxRequestError('invalid-input', 'Choose a project for collected videos first');
      // The publication worker performs the check, so a slow download never holds this request open.
      store.requestCheck(input.accountId);
    }
    return view(store, account);
  } finally { store.close(); accounts.close(); }
}
function session(request?: typeof globalThis.fetch) {
  const accounts = openInstagramAccounts({ fetch: request }), store = new InstagramInboxStore();
  const deps: InboxDependencies = { store, credential: accounts.messaging.credential, invalidate: accounts.messaging.invalidate, fetch: request };
  return { deps, close() { store.close(); accounts.close(); } };
}
/** CLI: one check in the foreground. */
export async function collectInboxNow(accountId: string, signal: AbortSignal, request?: typeof globalThis.fetch) {
  const current = session(request);
  try { return await collectInstagramInbox(accountId, current.deps, signal); }
  finally { current.close(); }
}
/** Opened by the publication worker for each pass; without Meta configuration due checks record reconnect. */
export function openInboxWorkerSession(request?: typeof globalThis.fetch) {
  const pending = new InstagramInboxStore();
  try {
    const due = pending.due();
    if (!due.length) return null;
    try { return session(request); }
    catch { for (const accountId of due) pending.finishCheck(accountId, 'reconnect'); return null; }
  } finally { pending.close(); }
}
