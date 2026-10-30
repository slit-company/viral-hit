import { m as uiMessages } from '@/paraglide/messages.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicationAccount } from '@/core/publishing/account-contract';
import type { AccountRequest, AccountSnapshot, ConnectResult } from '@/core/publishing/account-requests';
import { ApiError, apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';

const endpoint = '/api/app/publishing/accounts';
export function accountErrorMessage(issue: string) {
  switch (issue) {
    case 'denied': return uiMessages["ui.publishing.google_access_was_declined_you_can_connect_again_when_ready"]();
    case 'configuration': return uiMessages["ui.publishing.google_connection_settings_need_attention_from_the_workspace_operator"]();
    case 'invalid-callback': return uiMessages["ui.publishing.this_connection_attempt_expired_or_changed_start_a_new_connection_from_this"]();
    case 'identity-mismatch': return uiMessages["ui.publishing.choose_the_same_youtube_channel_when_reconnecting_add_a_new_connection_to_u"]();
    case 'scope-missing': return uiMessages["ui.publishing.grant_both_channel_access_and_video_upload_access_to_connect_youtube"]();
    case 'offline-unavailable': return uiMessages["ui.publishing.google_did_not_provide_ongoing_access_try_connecting_again"]();
    case 'grant-rejected': return uiMessages["ui.publishing.google_access_has_expired_or_was_revoked_reconnect_this_channel"]();
    case 'disconnected': return uiMessages["ui.publishing.this_channel_was_disconnected_refresh_the_list_before_continuing"]();
    case 'vault-unavailable': return uiMessages["ui.publishing.stored_connections_could_not_be_opened_ask_the_workspace_operator_to_check_"]();
    case 'busy': return uiMessages["ui.publishing.another_connection_operation_is_running_wait_a_moment_and_refresh"]();
    default: return uiMessages["ui.publishing.the_connection_request_could_not_finish_refresh_and_try_again"]();
  }
}
export function usePublishingAccounts() {
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const mounted = useRef(false), sequence = useRef(0), readController = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const version = ++sequence.current;
    readController.current?.abort(); const controller = new AbortController(); readController.current = controller;
    setLoading(true);
    try {
      const next = await apiJsonGet<AccountSnapshot>(endpoint, { signal: controller.signal, headers: { [WORKSPACE_MUTATION_HEADER]: WORKSPACE_MUTATION_HEADER_VALUE } });
      if (mounted.current && version === sequence.current) { setSnapshot(next); setError(null); }
    } catch { if (mounted.current && !controller.signal.aborted && version === sequence.current) setError(uiMessages["ui.publishing.connections_could_not_be_loaded_refresh_to_try_again"]()); }
    finally { if (mounted.current && version === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; readController.current?.abort(); }; }, [refresh]);
  async function change(body: AccountRequest) {
    if (pending) return false;
    setPending(true); setError(null);
    try {
      const result = await apiJsonPost<ConnectResult>(endpoint, body);
      if (!mounted.current) return false;
      if (body.action === 'connect') {
        const target = new URL(result.authorizationUrl);
        if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth') throw new Error(uiMessages["ui.publishing.unexpected_consent_destination"]());
        window.location.assign(target.href);
      } else await refresh();
      return true;
    } catch (failure) {
      const data = failure instanceof ApiError ? failure.data as { issue?: string } | undefined : undefined;
      if (mounted.current) setError(accountErrorMessage(data?.issue ?? 'temporarily-unavailable'));
      return false;
    } finally { if (mounted.current) setPending(false); }
  }
  return { snapshot, loading, pending, error, refresh,
    connect: (account?: PublicationAccount) => change({ action: 'connect', ...(account ? { reconnect: { accountId: account.id, revision: account.revision } } : {}) }),
    disconnect: (account: PublicationAccount) => change({ action: 'disconnect', accountId: account.id, revision: account.revision }),
  };
}
