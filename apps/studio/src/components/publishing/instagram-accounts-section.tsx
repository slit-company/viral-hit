import { m as uiMessages } from '@/paraglide/messages.js';
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
    <section aria-label={uiMessages["ui.publishing.instagram_connection"]()} className="overflow-hidden rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)]">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--vh-control)]"><Instagram className="size-6" aria-hidden="true" /></span><div><h2 className="text-lg font-semibold">Instagram</h2><p className="text-sm text-[var(--vh-text-2)]">{uiMessages["ui.publishing.professional_accounts_through_meta"]()}</p></div></div>
        <Button size="lg" disabled={disabled || !ready} onClick={() => void account.connect()}><ExternalLink /> {uiMessages["ui.publishing.connect_instagram"]()}</Button>
      </div>
      <div className="border-t border-[var(--vh-border)] px-5 py-4 text-sm leading-6 text-[var(--vh-text-2)] sm:px-6">
        {loading && !snapshot ? <p role="status">{uiMessages["ui.publishing.loading_instagram_connections"]()}</p> : !snapshot ? <p>{uiMessages["ui.publishing.connection_status_is_unavailable"]()}</p> : ready ? <p>{uiMessages["ui.publishing.allow_access_through_meta_then_choose_the_page_linked_to_your_instagram_acc"]()}</p> : snapshot.instagram === 'origin-mismatch' ? <p>{uiMessages["ui.publishing.the_meta_callback_belongs_to_a_different_studio_address_open_the_configured"]()}</p> : <p>{uiMessages["ui.publishing.meta_connection_is_not_configured_yet_ask_your_workspace_operator_to_enable"]()}</p>}
        <p className="mt-2">{uiMessages["ui.publishing.connecting_does_not_publish_a_post_prepare_and_approve_a_reel_or_story_from"]()}</p>
      </div>
    </section>
    {selection && <section aria-label={uiMessages["ui.publishing.choose_instagram_destination"]()} className="space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-6">
      <div className="space-y-2"><h3 className="text-lg font-semibold">{uiMessages["ui.publishing.choose_your_instagram_account"]()}</h3><p className="text-sm leading-6 text-[var(--vh-text-2)]">{uiMessages["ui.publishing.only_this_selected_account_will_be_saved_this_choice_expires_in_a_few_minut"]()}</p></div>
      <label className="block space-y-2 text-sm font-medium">{uiMessages["ui.publishing.page_and_instagram_account"]()}<NativeSelect aria-label={uiMessages["ui.publishing.page_and_instagram_account"]()} value={selected?.pageId ?? ''} disabled={disabled} onChange={event => setPageId(event.target.value)}>
        <option value="">{uiMessages["ui.publishing.choose_an_account"]()}</option>{selection.candidates.map(candidate => <option key={candidate.pageId} value={candidate.pageId}>{candidate.username ? `@${candidate.username}` : candidate.instagramId} · {candidate.pageName}</option>)}
      </NativeSelect></label>
      {selected && <dl className="space-y-3 break-words rounded-xl bg-[var(--vh-control)] p-4 text-sm [overflow-wrap:anywhere]">
        <div><dt className="text-[var(--vh-text-2)]">Instagram</dt><dd className="mt-1 font-medium">{selected.username ? `@${selected.username}` : uiMessages["ui.publishing.professional_account"]()}<span className="mt-1 block text-xs font-normal">ID {selected.instagramId}</span></dd></div>
        <div><dt className="text-[var(--vh-text-2)]">{uiMessages["ui.publishing.facebook_page"]()}</dt><dd className="mt-1 font-medium">{selected.pageName}<span className="mt-1 block text-xs font-normal">ID {selected.pageId}</span></dd></div>
      </dl>}
      <div className="flex flex-wrap gap-2"><Button disabled={disabled || !selected} onClick={() => selected && void account.select(selected.pageId)}>{uiMessages["ui.publishing.connect_this_account"]()}</Button><Button variant="outline" disabled={pending} onClick={() => void account.cancel()}>{uiMessages["ui.publishing.cancel_connection"]()}</Button></div>
    </section>}
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{uiMessages["ui.publishing.your_instagram_accounts"]()}</h3><Button aria-label={uiMessages["ui.publishing.refresh_instagram_accounts"]()} variant="ghost" disabled={disabled} onClick={() => void account.refresh()}><RefreshCw className={loading ? 'animate-spin' : ''} /> {uiMessages["ui.publishing.refresh"]()}</Button></div>
    {snapshot?.accounts.length === 0 && <p className="rounded-2xl border border-dashed border-[var(--vh-border)] p-7 text-center text-sm text-[var(--vh-text-2)]">{uiMessages["ui.publishing.no_instagram_accounts_connected_yet"]()}</p>}
    {snapshot?.accounts.map(item => <article key={item.id} aria-label={uiMessages["ui.publishing.instagram_account_named"]({ name: item.username || item.instagramId })} className="space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]"><h3 className="font-semibold">{item.username ? `@${item.username}` : uiMessages["ui.publishing.instagram_account"]()}</h3><p className="mt-1 text-sm text-[var(--vh-text-2)]">{item.pageName}</p><p className="mt-1 text-xs text-[var(--vh-text-2)]">Instagram {item.instagramId} {uiMessages["ui.publishing.page"]()} {item.pageId}</p></div><span className="rounded-full bg-[var(--vh-control)] px-3 py-1 text-xs font-medium">{item.status === 'connected' ? uiMessages["ui.publishing.connected"]() : item.status === 'reconnect-required' ? uiMessages["ui.publishing.reconnect_required"]() : uiMessages["ui.publishing.disconnected"]()}</span></div>
      {item.issue && <p className="text-sm text-[var(--vh-text-2)]">{instagramAccountError(item.issue)}</p>}
      {confirmId === item.id ? <div className="space-y-3 border-t border-[var(--vh-border)] pt-4"><p className="text-sm leading-6">{uiMessages["ui.publishing.disconnect_this_account_from_viral_hit_existing_posts_stay_on_instagram"]()}</p><div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={disabled} onClick={async () => { if (await account.disconnect(item)) setConfirmId(null); }}>{uiMessages["ui.publishing.confirm_disconnect"]()}</Button><Button variant="outline" disabled={pending} onClick={() => setConfirmId(null)}>{uiMessages["ui.publishing.keep_connected"]()}</Button></div></div> : <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={disabled || !ready} onClick={() => void account.connect(item)}>{item.status === 'connected' ? uiMessages["ui.publishing.renew_access"]() : uiMessages["ui.publishing.reconnect"]()}</Button>{item.status !== 'disconnected' && <Button variant="ghost" disabled={disabled} onClick={() => setConfirmId(item.id)}>{uiMessages["ui.publishing.disconnect"]()}</Button>}</div>}
    </article>)}
  </div>;
}
