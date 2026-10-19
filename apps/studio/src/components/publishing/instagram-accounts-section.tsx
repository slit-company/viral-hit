import { useState } from 'react';
import { ExternalLink, Instagram, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { instagramAccountError, useInstagramAccounts } from './use-instagram-accounts';

export function InstagramAccountsSection({ issue, state, onSelectionDone }: { issue?: string; state?: string; onSelectionDone: () => void }) {
  const account = useInstagramAccounts(state, onSelectionDone), { snapshot, selection, loading, pending, error } = account;
  const [pageId, setPageId] = useState(''), [confirmId, setConfirmId] = useState<string | null>(null);
  const ready = snapshot?.instagram === 'ready', disabled = loading || pending, selected = selection?.candidates.find(candidate => candidate.pageId === pageId);
  return <div className="space-y-4">
    {issue && !['select', 'connected'].includes(issue) && <p role="status" className="rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-4 text-sm">{instagramAccountError(issue)}</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">{error}</p>}
    <section aria-label="Instagram connection" className="overflow-hidden rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--vh-control)]"><Instagram className="size-6" aria-hidden="true" /></span><div><h2 className="text-lg font-semibold">Instagram</h2><p className="text-sm text-[var(--vh-text-2)]">Professional accounts through Meta</p></div></div>
        <Button size="lg" disabled={disabled || !ready} onClick={() => void account.connect()}><ExternalLink /> Connect Instagram</Button>
      </div>
      <div className="border-t border-[var(--vh-border)] px-5 py-4 text-sm leading-6 text-[var(--vh-text-2)] sm:px-6">
        {loading && !snapshot ? <p role="status">Loading Instagram connections…</p> : !snapshot ? <p>Connection status is unavailable.</p> : ready ? <p>Allow access through Meta, then choose the Page linked to your Instagram account. Access stays on this workspace’s server.</p> : snapshot.instagram === 'origin-mismatch' ? <p>The Meta callback belongs to a different studio address. Open the configured address or ask your workspace operator to update it.</p> : <p>Meta connection is not configured yet. Ask your workspace operator to enable Instagram for this studio.</p>}
        <p className="mt-2">Connecting does not publish a post. Instagram delivery is not available in Publish yet.</p>
      </div>
    </section>
    {selection && <section aria-label="Choose Instagram destination" className="space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-6">
      <div className="space-y-2"><h3 className="text-lg font-semibold">Choose your Instagram account</h3><p className="text-sm leading-6 text-[var(--vh-text-2)]">Only this selected account will be saved. This choice expires in a few minutes.</p></div>
      <label className="block space-y-2 text-sm font-medium">Page and Instagram account<NativeSelect aria-label="Page and Instagram account" value={selected?.pageId ?? ''} disabled={disabled} onChange={event => setPageId(event.target.value)}>
        <option value="">Choose an account</option>{selection.candidates.map(candidate => <option key={candidate.pageId} value={candidate.pageId}>{candidate.username ? `@${candidate.username}` : candidate.instagramId} · {candidate.pageName}</option>)}
      </NativeSelect></label>
      {selected && <dl className="space-y-3 break-words rounded-xl bg-[var(--vh-control)] p-4 text-sm [overflow-wrap:anywhere]">
        <div><dt className="text-[var(--vh-text-2)]">Instagram</dt><dd className="mt-1 font-medium">{selected.username ? `@${selected.username}` : 'Professional account'}<span className="mt-1 block text-xs font-normal">ID {selected.instagramId}</span></dd></div>
        <div><dt className="text-[var(--vh-text-2)]">Facebook Page</dt><dd className="mt-1 font-medium">{selected.pageName}<span className="mt-1 block text-xs font-normal">ID {selected.pageId}</span></dd></div>
      </dl>}
      <div className="flex flex-wrap gap-2"><Button disabled={disabled || !selected} onClick={() => selected && void account.select(selected.pageId)}>Connect this account</Button><Button variant="outline" disabled={pending} onClick={() => void account.cancel()}>Cancel connection</Button></div>
    </section>}
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Your Instagram accounts</h3><Button aria-label="Refresh Instagram accounts" variant="ghost" disabled={disabled} onClick={() => void account.refresh()}><RefreshCw className={loading ? 'animate-spin' : ''} /> Refresh</Button></div>
    {snapshot?.accounts.length === 0 && <p className="rounded-2xl border border-dashed border-[var(--vh-border)] p-7 text-center text-sm text-[var(--vh-text-2)]">No Instagram accounts connected yet.</p>}
    {snapshot?.accounts.map(item => <article key={item.id} aria-label={`Instagram account ${item.username || item.instagramId}`} className="space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]"><h3 className="font-semibold">{item.username ? `@${item.username}` : 'Instagram account'}</h3><p className="mt-1 text-sm text-[var(--vh-text-2)]">{item.pageName}</p><p className="mt-1 text-xs text-[var(--vh-text-2)]">Instagram {item.instagramId} · Page {item.pageId}</p></div><span className="rounded-full bg-[var(--vh-control)] px-3 py-1 text-xs font-medium">{item.status === 'connected' ? 'Connected' : item.status === 'reconnect-required' ? 'Reconnect required' : 'Disconnected'}</span></div>
      {item.issue && <p className="text-sm text-[var(--vh-text-2)]">{instagramAccountError(item.issue)}</p>}
      {confirmId === item.id ? <div className="space-y-3 border-t border-[var(--vh-border)] pt-4"><p className="text-sm leading-6">Disconnect this account from Viral Hit? Existing posts stay on Instagram.</p><div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={disabled} onClick={async () => { if (await account.disconnect(item)) setConfirmId(null); }}>Confirm disconnect</Button><Button variant="outline" disabled={pending} onClick={() => setConfirmId(null)}>Keep connected</Button></div></div> : <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled || !ready} onClick={() => void account.connect(item)}>{item.status === 'connected' ? 'Renew access' : 'Reconnect'}</Button>{item.status !== 'disconnected' && <Button variant="ghost" disabled={disabled} onClick={() => setConfirmId(item.id)}>Disconnect</Button>}</div>}
    </article>)}
  </div>;
}
