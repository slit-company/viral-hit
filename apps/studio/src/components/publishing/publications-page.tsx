import { m as uiMessages } from '@/paraglide/messages.js';
import { useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { ProductPageShell } from '@/components/app/product-page-shell';
import { Button } from '@/components/ui/button';
import { Link } from '@/core/i18n/navigation';
import type { PublicationView } from '@/core/publishing/public-view';
import { usePublications } from './use-publications';
import { PublicationForm } from './publication-form';
import { PublicationCard } from './publication-card';
import { PerformanceSection } from './performance-section';
import { usePerformance } from './use-performance';

export function PublicationsPage({ projectId }: { projectId: string }) {
  const state = usePublications(projectId), performance = usePerformance(projectId), [editing, setEditing] = useState<PublicationView | undefined>(), [formVersion, setFormVersion] = useState(0);
  const [connector, setConnector] = useState('youtube');
  const done = () => { setEditing(undefined); setFormVersion(value => value + 1); };
  return <ProductPageShell projectId={projectId} workspaceName={state.snapshot?.project.name ?? uiMessages["ui.publishing.publishing"]()} publishing>
    <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--vh-text-2)]"><Send className="size-4" aria-hidden="true" /> {uiMessages["ui.publishing.from_studio_to_channel"]()}</span><h1 className="text-3xl font-semibold tracking-tight">{uiMessages["ui.publishing.publish_your_work"]()}</h1><p className="max-w-xl text-sm leading-6 text-[var(--vh-text-2)]">{uiMessages["ui.publishing.prepare_your_media_review_every_detail_and_follow_delivery_to_a_connected_c"]()}</p></div><div className="flex items-center gap-3"><Link href="/connections" className="text-sm font-medium underline">{uiMessages["ui.publishing.connections"]()}</Link><Button variant="outline" disabled={state.pending} onClick={() => { void state.refresh(); void performance.refresh(); }}><RefreshCw className={state.loading ? 'animate-spin' : ''} /> {uiMessages["ui.publishing.refresh"]()}</Button></div></div>
        {!!state.snapshot?.installedConnectors.problems.length && <section aria-label={uiMessages["ui.publishing.connector_problems"]()} className="rounded-xl border border-amber-500/30 p-4 text-sm"><h2 className="font-medium">{uiMessages["ui.publishing.some_installed_destinations_could_not_load"]()}</h2>{state.snapshot.installedConnectors.problems.map(problem => <p key={problem.location} className="mt-2 break-words text-xs text-[var(--vh-text-2)]">{problem.location}: {problem.message}</p>)}</section>}
        {state.error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">{state.error}</p>}
        {state.loading && !state.snapshot ? <p role="status">{uiMessages["ui.publishing.loading_publications"]()}</p> : state.snapshot && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div id="publication-form"><PublicationForm key={`${formVersion}-${editing?.id ?? 'new'}-${editing?.revision ?? 0}`} projectId={projectId} connector={connector} onConnector={setConnector} installedConnectors={state.snapshot.installedConnectors.connectors} mediaAssets={state.mediaAssets} instagramAccounts={state.instagramAccounts} accounts={state.accounts?.accounts ?? []} videos={state.videos} pending={state.pending} editing={editing} change={state.change} done={done} /></div>
          <section aria-labelledby="delivery-queue-heading" className="min-w-0 space-y-4"><div className="flex items-center justify-between gap-3"><h2 id="delivery-queue-heading" className="text-lg font-semibold">{uiMessages["ui.publishing.review_delivery"]()}</h2><span className="text-xs text-[var(--vh-text-2)]">{state.snapshot.publications.length} {uiMessages["ui.publishing.recent"]()}</span></div>
            {state.snapshot.publications.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--vh-border)] p-8 text-center"><p className="font-medium">{uiMessages["ui.publishing.your_next_release_starts_here"]()}</p><p className="mt-2 text-sm leading-6 text-[var(--vh-text-2)]">{uiMessages["ui.publishing.saved_drafts_appear_here_for_review"]()}<br />{uiMessages["ui.publishing.nothing_uploads_until_you_approve_it"]()}</p></div>}
            {state.snapshot.publications.map(item => {
              const account = state.accounts?.accounts.find(value => value.id === item.accountId);
              const instagram = state.instagramAccounts.find(value => value.id === item.accountId);
              const canApprove = item.connector === 'instagram'
                ? state.snapshot!.connectors.instagram && instagram?.status === 'connected' && instagram.instagramId === item.destinationId
                : state.snapshot!.configured && account?.status === 'connected' && account.channelId === item.destinationId;
              return <PublicationCard key={`${item.id}-${item.revision}-${item.digest}`} item={item} channelTitle={item.connector === 'instagram' ? instagram?.username : account?.channelTitle} canApprove={canApprove} pending={state.pending} change={state.change} edit={() => { setConnector(item.connector); setEditing(item); document.getElementById('publication-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />;
            })}
          </section>
        </div>}
        <PerformanceSection state={performance} />
      </div>
    </div>
  </ProductPageShell>;
}
