import { m as uiMessages } from '@/paraglide/messages.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstagramAccount, InstagramAccountRequest, InstagramSelection } from '@/core/publishing/instagram-accounts-contract';
import type { AccountAvailability, ConnectResult } from '@/core/publishing/account-requests';
import { ApiError, apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';

const endpoint = '/api/app/publishing/instagram/accounts';
type Snapshot = { accounts: InstagramAccount[]; instagram: AccountAvailability };
export function instagramAccountError(issue: string) {
  switch (issue) {
    case 'denied': return uiMessages["ui.publishing.meta_access_was_declined_you_can_connect_again_when_ready"]();
    case 'configuration': return uiMessages["ui.publishing.meta_connection_settings_need_attention_from_the_workspace_operator"]();
    case 'invalid-callback': return uiMessages["ui.publishing.this_connection_attempt_expired_or_changed_connect_instagram_again_from_thi"]();
    case 'identity-mismatch': return uiMessages["ui.publishing.choose_a_page_linked_to_your_professional_instagram_account_reconnecting_mu"]();
    case 'scope-missing': return uiMessages["ui.publishing.grant_the_requested_page_and_instagram_publishing_permissions_to_continue"]();
    case 'grant-rejected': return uiMessages["ui.publishing.meta_access_expired_or_was_revoked_reconnect_this_account"]();
    case 'disconnected': return uiMessages["ui.publishing.this_account_was_disconnected_refresh_before_continuing"]();
    case 'vault-unavailable': return uiMessages["ui.publishing.stored_instagram_connections_could_not_be_opened_ask_the_workspace_operator"]();
    case 'busy': return uiMessages["ui.publishing.this_connection_is_busy_or_contains_too_many_pages_try_again_with_fewer_sel"]();
    default: return uiMessages["ui.publishing.instagram_connection_could_not_finish_refresh_or_start_a_new_connection"]();
  }
}
export function useInstagramAccounts(state: string | undefined, onSelectionDone: () => void) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [selection, setSelection] = useState<InstagramSelection | null>(null);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const mounted = useRef(false), busy = useRef(false), sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const message = (error: unknown) => instagramAccountError(error instanceof ApiError ? (error.data as { issue?: string } | undefined)?.issue ?? '' : '');
  const refresh = useCallback(async () => {
    const version = ++sequence.current; controller.current?.abort(); const active = new AbortController(); controller.current = active;
    const options = { signal: active.signal, headers: { [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE } };
    setLoading(true); setSelection(null);
    const results = await Promise.allSettled([
      apiJsonGet<Snapshot>(endpoint, options),
      state ? apiJsonGet<{ selection: InstagramSelection }>(`${endpoint}?state=${encodeURIComponent(state)}`, options) : Promise.resolve(null),
    ]);
    if (!mounted.current || active.signal.aborted || version !== sequence.current) return;
    const [accounts, choices] = results;
    if (accounts.status === 'fulfilled') setSnapshot(accounts.value);
    if (choices.status === 'fulfilled') setSelection(choices.value?.selection ?? null);
    setError(accounts.status === 'rejected' ? message(accounts.reason) : choices.status === 'rejected' ? message(choices.reason) : null);
    setLoading(false);
  }, [state]);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; controller.current?.abort(); }; }, [refresh]);
  async function change(body: InstagramAccountRequest) {
    if (busy.current) return false;
    busy.current = true; setPending(true); setError(null);
    try {
      const result = await apiJsonPost<ConnectResult>(endpoint, body);
      if (!mounted.current) return false;
      if (body.action === 'connect') {
        const target = new URL(result.authorizationUrl);
        if (target.origin !== 'https://www.facebook.com' || !/^\/v\d+\.0\/dialog\/oauth$/.test(target.pathname) || target.username || target.password) throw new Error(uiMessages["ui.publishing.unexpected_consent_destination"]());
        window.location.assign(target.href);
      } else if (body.action === 'select' || body.action === 'cancel') { setSelection(null); onSelectionDone(); }
      else await refresh();
      return true;
    } catch (error) { if (mounted.current) setError(message(error)); return false; }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  return { snapshot, selection, loading, pending, error, refresh,
    connect: (account?: InstagramAccount) => change({ action: 'connect', ...(account ? { reconnect: { accountId: account.id, revision: account.revision } } : {}) }),
    disconnect: (account: InstagramAccount) => change({ action: 'disconnect', accountId: account.id, revision: account.revision }),
    select: (pageId: string) => state ? change({ action: 'select', state, pageId }) : Promise.resolve(false),
    cancel: () => state ? change({ action: 'cancel', state }) : Promise.resolve(false),
  };
}
