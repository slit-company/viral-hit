import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicationAccount } from '@/core/publishing/account-contract';
import type { AccountRequest, AccountSnapshot, ConnectResult } from '@/core/publishing/account-requests';
import { ApiError, apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';

const endpoint = '/api/app/publishing/accounts';
export function accountErrorMessage(issue: string) {
  switch (issue) {
    case 'denied': return 'Google access was declined. You can connect again when ready.';
    case 'configuration': return 'Google connection settings need attention from the workspace operator.';
    case 'invalid-callback': return 'This connection attempt expired or changed. Start a new connection from this browser.';
    case 'identity-mismatch': return 'Choose the same YouTube channel when reconnecting. Add a new connection to use a different channel.';
    case 'scope-missing': return 'Grant both channel access and video upload access to connect YouTube.';
    case 'offline-unavailable': return 'Google did not provide ongoing access. Try connecting again.';
    case 'grant-rejected': return 'Google access has expired or was revoked. Reconnect this channel.';
    case 'disconnected': return 'This channel was disconnected. Refresh the list before continuing.';
    case 'vault-unavailable': return 'Stored connections could not be opened. Ask the workspace operator to check account storage.';
    case 'busy': return 'Another connection operation is running. Wait a moment and refresh.';
    default: return 'The connection request could not finish. Refresh and try again.';
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
    } catch { if (mounted.current && !controller.signal.aborted && version === sequence.current) setError('Connections could not be loaded. Refresh to try again.'); }
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
        if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth') throw new Error('Unexpected consent destination');
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
