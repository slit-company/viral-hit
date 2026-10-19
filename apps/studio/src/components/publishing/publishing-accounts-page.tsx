import { useState } from 'react';
import { ExternalLink, Link2, RefreshCw, Youtube } from 'lucide-react';
import { ProductPageShell } from '@/components/app/product-page-shell';
import { Button } from '@/components/ui/button';
import { accountErrorMessage, usePublishingAccounts } from './use-publishing-accounts';

export function PublishingAccountsPage({ callbackIssue }: { callbackIssue?: string }) {
  const { snapshot, loading, pending, error, refresh, connect, disconnect } = usePublishingAccounts();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const ready = snapshot?.youtube === 'ready', disabled = pending || loading;
  return <ProductPageShell workspaceName="Connections">
    <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--vh-text-2)]"><Link2 className="size-4" aria-hidden="true" /> Publishing</span>
          <h1 className="text-3xl font-semibold tracking-tight">Connect your channels</h1>
          <p className="max-w-xl text-sm leading-6 text-[var(--vh-text-2)]">Choose where your work can go. Connections belong to this workspace and can be used across projects.</p>
        </div>
        {callbackIssue && callbackIssue !== 'connected' && <p role="status" className="rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-4 text-sm">{accountErrorMessage(callbackIssue)}</p>}
        {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">{error}</p>}
        <section aria-label="YouTube connection" className="overflow-hidden rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)]">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
            <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--vh-control)]"><Youtube className="size-6" aria-hidden="true" /></span>
              <div><h2 className="text-lg font-semibold">YouTube</h2><p className="text-sm text-[var(--vh-text-2)]">Connect through Google</p></div></div>
            <Button size="lg" disabled={disabled || !ready} onClick={() => void connect()}><ExternalLink /> Connect YouTube</Button>
          </div>
          <div className="border-t border-[var(--vh-border)] px-5 py-4 text-sm leading-6 text-[var(--vh-text-2)] sm:px-6">
            {loading && !snapshot ? <p role="status">Loading connections…</p> : !snapshot ? <p>Connection status is unavailable.</p> : ready ? <p>Google will ask you to choose a channel and allow channel lookup and video uploads. Access stays on this workspace’s server.</p> : snapshot.youtube === 'origin-mismatch' ? <p>The Google callback belongs to a different studio address. Open the configured studio address or ask your workspace operator to update it.</p> : <p>Google connection is not configured yet. Ask your workspace operator to enable YouTube for this studio.</p>}
            <p className="mt-2">Connecting does not upload a video. Open Publish in a project to prepare and approve a delivery.</p>
          </div>
        </section>
        <section aria-labelledby="connected-channels" className="space-y-3">
          <div className="flex items-center justify-between gap-3"><h2 id="connected-channels" className="font-semibold">Your channels</h2><Button variant="ghost" disabled={disabled} onClick={() => void refresh()}><RefreshCw className={loading ? 'animate-spin' : ''} /> Refresh</Button></div>
          {snapshot?.accounts.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--vh-border)] p-7 text-center text-sm text-[var(--vh-text-2)]">No channels connected yet.</div>}
          {snapshot?.accounts.map(account => <article key={account.id} aria-label={`Channel ${account.channelTitle}`} className="space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1"><h3 className="break-words font-semibold [overflow-wrap:anywhere]">{account.channelTitle || 'YouTube channel'}</h3><p className="mt-1 break-all text-xs text-[var(--vh-text-2)]">{account.channelId}</p></div>
              <span className="rounded-full bg-[var(--vh-control)] px-3 py-1 text-xs font-medium">{account.status === 'connected' ? 'Connected' : account.status === 'reconnect-required' ? 'Reconnect required' : 'Disconnected'}</span>
            </div>
            {account.issue && <p className="text-sm text-[var(--vh-text-2)]">{accountErrorMessage(account.issue)}</p>}
            {confirmId === account.id ? <div className="space-y-3 border-t border-[var(--vh-border)] pt-4">
              <p className="text-sm leading-6">Disconnect this channel from Viral Hit? Uploaded videos and remote schedules stay on YouTube.</p>
              <div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={disabled} onClick={async () => { if (await disconnect(account)) setConfirmId(null); }}>Confirm disconnect</Button><Button variant="outline" disabled={pending} onClick={() => setConfirmId(null)}>Keep connected</Button></div>
            </div> : <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled || !ready} onClick={() => void connect(account)}>{account.status === 'connected' ? 'Renew access' : 'Reconnect'}</Button>{account.status !== 'disconnected' && <Button variant="ghost" disabled={disabled} onClick={() => setConfirmId(account.id)}>Disconnect</Button>}</div>}
          </article>)}
        </section>
      </div>
    </div>
  </ProductPageShell>;
}
