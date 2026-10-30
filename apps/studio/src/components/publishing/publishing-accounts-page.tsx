import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { InstagramAccountsSection } from './instagram-accounts-section';
import { ExternalLink, Link2, RefreshCw, Youtube } from 'lucide-react';
import { ProductPageShell } from '@/components/app/product-page-shell';
import { Button } from '@/components/ui/button';
import { accountErrorMessage, usePublishingAccounts } from './use-publishing-accounts';
import { ProviderConnections } from '@/components/extensions/provider-connections';
import { getLocale } from '@/paraglide/runtime.js';

export function PublishingAccountsPage({ callbackIssue, instagramIssue, instagramState, onInstagramSelectionDone }: { callbackIssue?: string; instagramIssue?: string; instagramState?: string; onInstagramSelectionDone: () => void }) {
  const { snapshot, loading, pending, error, refresh, connect, disconnect } = usePublishingAccounts();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const ready = snapshot?.youtube === 'ready', disabled = pending || loading;
  return <ProductPageShell workspaceName={uiMessages["ui.publishing.connections"]()}>
    <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="space-y-3">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--vh-text-2)]"><Link2 className="size-4" aria-hidden="true" /> {uiMessages["ui.app.publishing_connections"]()}</span>
          <h1 className="text-3xl font-semibold tracking-tight">{uiMessages["ui.publishing.connect_your_channels"]()}</h1>
          <p className="max-w-xl text-sm leading-6 text-[var(--vh-text-2)]">{uiMessages["ui.publishing.choose_where_your_work_can_go_connections_belong_to_this_workspace_and_can_"]()}</p>
        </div>
        {callbackIssue && callbackIssue !== 'connected' && <p role="status" className="rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-4 text-sm">{accountErrorMessage(callbackIssue)}</p>}
        <ProviderConnections locale={getLocale()} />
        <h2 className="flex items-center gap-2 pt-4 text-xl font-semibold"><Link2 size={20} aria-hidden="true" />{uiMessages["ui.publishing.publishing"]()}</h2>
        {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">{error}</p>}
        <section aria-label={uiMessages["ui.publishing.youtube_connection"]()} className="overflow-hidden rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)]">
          <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
            <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--vh-control)]"><Youtube className="size-6" aria-hidden="true" /></span>
              <div><h2 className="text-lg font-semibold">YouTube</h2><p className="text-sm text-[var(--vh-text-2)]">{uiMessages["ui.publishing.connect_through_google"]()}</p></div></div>
            <Button size="lg" disabled={disabled || !ready} onClick={() => void connect()}><ExternalLink /> {uiMessages["ui.publishing.connect_youtube"]()}</Button>
          </div>
          <div className="border-t border-[var(--vh-border)] px-5 py-4 text-sm leading-6 text-[var(--vh-text-2)] sm:px-6">
            {loading && !snapshot ? <p role="status">{uiMessages["ui.publishing.loading_connections"]()}</p> : !snapshot ? <p>{uiMessages["ui.publishing.connection_status_is_unavailable"]()}</p> : ready ? <p>{uiMessages["ui.publishing.google_will_ask_you_to_choose_a_channel_and_allow_channel_lookup_and_video_"]()}</p> : snapshot.youtube === 'origin-mismatch' ? <p>{uiMessages["ui.publishing.the_google_callback_belongs_to_a_different_studio_address_open_the_configur"]()}</p> : <p>{uiMessages["ui.publishing.google_connection_is_not_configured_yet_ask_your_workspace_operator_to_enab"]()}</p>}
            <p className="mt-2">{uiMessages["ui.publishing.connecting_does_not_upload_a_video_open_publish_in_a_project_to_prepare_and"]()}</p>
          </div>
        </section>
        <section aria-labelledby="connected-channels" className="space-y-3">
          <div className="flex items-center justify-between gap-3"><h2 id="connected-channels" className="font-semibold">{uiMessages["ui.publishing.your_channels"]()}</h2><Button variant="ghost" disabled={disabled} onClick={() => void refresh()}><RefreshCw className={loading ? 'animate-spin' : ''} /> {uiMessages["ui.publishing.refresh"]()}</Button></div>
          {snapshot?.accounts.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--vh-border)] p-7 text-center text-sm text-[var(--vh-text-2)]">{uiMessages["ui.publishing.no_channels_connected_yet"]()}</div>}
          {snapshot?.accounts.map(account => <article key={account.id} aria-label={uiMessages["ui.publishing.channel_name"]({ name: account.channelTitle })} className="space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1"><h3 className="break-words font-semibold [overflow-wrap:anywhere]">{account.channelTitle || uiMessages["ui.publishing.youtube_channel"]()}</h3><p className="mt-1 break-all text-xs text-[var(--vh-text-2)]">{account.channelId}</p></div>
              <span className="rounded-full bg-[var(--vh-control)] px-3 py-1 text-xs font-medium">{account.status === 'connected' ? uiMessages["ui.publishing.connected"]() : account.status === 'reconnect-required' ? uiMessages["ui.publishing.reconnect_required"]() : uiMessages["ui.publishing.disconnected"]()}</span>
            </div>
            {account.issue && <p className="text-sm text-[var(--vh-text-2)]">{accountErrorMessage(account.issue)}</p>}
            {confirmId === account.id ? <div className="space-y-3 border-t border-[var(--vh-border)] pt-4">
              <p className="text-sm leading-6">{uiMessages["ui.publishing.disconnect_this_channel_from_viral_hit_uploaded_videos_and_remote_schedules"]()}</p>
              <div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={disabled} onClick={async () => { if (await disconnect(account)) setConfirmId(null); }}>{uiMessages["ui.publishing.confirm_disconnect"]()}</Button><Button variant="outline" disabled={pending} onClick={() => setConfirmId(null)}>{uiMessages["ui.publishing.keep_connected"]()}</Button></div>
            </div> : <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled || !ready} onClick={() => void connect(account)}>{account.status === 'connected' ? uiMessages["ui.publishing.renew_access"]() : uiMessages["ui.publishing.reconnect"]()}</Button>{account.status !== 'disconnected' && <Button variant="ghost" disabled={disabled} onClick={() => setConfirmId(account.id)}>{uiMessages["ui.publishing.disconnect"]()}</Button>}</div>}
          </article>)}
        </section>
        <InstagramAccountsSection issue={instagramIssue} state={instagramState} onSelectionDone={onInstagramSelectionDone} />
      </div>
    </div>
  </ProductPageShell>;
}
