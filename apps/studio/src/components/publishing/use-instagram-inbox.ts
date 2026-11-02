import { m as uiMessages } from '@/paraglide/messages.js';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';
import type { InboxView } from '@/core/references/instagram-inbox-contract';

export type InstagramInbox = InboxView;
const endpoint = '/api/app/publishing/instagram/inbox', headers = { [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE };

/** All inbox settings at once; polls only while a requested check is waiting for the worker. */
export function useInstagramInbox() {
  const [inboxes, setInboxes] = useState<InstagramInbox[]>([]), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setInboxes((await apiJsonGet<{ inboxes: InstagramInbox[] }>(endpoint, { headers })).inboxes); } catch { /* keep the last known state */ }
  }, []);
  const waiting = inboxes.some(item => item.check.requestedAt);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!waiting) return; const timer = setInterval(() => void refresh(), 10000); return () => clearInterval(timer); }, [waiting, refresh]);
  async function change(request: Record<string, unknown>) {
    setPending(true); setError(null);
    try {
      const next = await apiJsonPost<InstagramInbox>(endpoint, request);
      setInboxes(previous => previous.some(item => item.accountId === next.accountId) ? previous.map(item => item.accountId === next.accountId ? next : item) : [...previous, next]);
      return true;
    } catch (failure) { setError(failure instanceof ApiError ? failure.message : uiMessages["ui.inbox.unavailable"]()); return false; }
    finally { setPending(false); }
  }
  return { inboxes, pending, error, refresh, change };
}
