import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstagramAccount, InstagramAccountRequest, InstagramSelection } from '@/core/publishing/instagram-accounts-contract';
import type { AccountAvailability, ConnectResult } from '@/core/publishing/account-requests';
import { ApiError, apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { WORKSPACE_MUTATION_HEADER, WORKSPACE_MUTATION_HEADER_VALUE } from '@/lib/trusted-local-request';

const endpoint = '/api/app/publishing/instagram/accounts';
type Snapshot = { accounts: InstagramAccount[]; instagram: AccountAvailability };
export function instagramAccountError(issue: string) {
  switch (issue) {
    case 'denied': return 'Meta access was declined. You can connect again when ready.';
    case 'configuration': return 'Meta connection settings need attention from the workspace operator.';
    case 'invalid-callback': return 'This connection attempt expired or changed. Connect Instagram again from this browser.';
    case 'identity-mismatch': return 'Choose a Page linked to your professional Instagram account. Reconnecting must keep the original Page and Instagram account.';
    case 'scope-missing': return 'Grant the requested Page and Instagram publishing permissions to continue.';
    case 'grant-rejected': return 'Meta access expired or was revoked. Reconnect this account.';
    case 'disconnected': return 'This account was disconnected. Refresh before continuing.';
    case 'vault-unavailable': return 'Stored Instagram connections could not be opened. Ask the workspace operator to check account storage.';
    case 'busy': return 'This connection is busy or contains too many Pages. Try again with fewer selected Pages.';
    default: return 'Instagram connection could not finish. Refresh or start a new connection.';
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
        if (target.origin !== 'https://www.facebook.com' || !/^\/v\d+\.0\/dialog\/oauth$/.test(target.pathname) || target.username || target.password) throw new Error('Unexpected consent destination');
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
