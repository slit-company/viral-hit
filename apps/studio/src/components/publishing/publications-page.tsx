import { useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { ProductPageShell } from '@/components/app/product-page-shell';
import { Button } from '@/components/ui/button';
import { Link } from '@/core/i18n/navigation';
import type { PublicationView } from '@/core/publishing/public-view';
import { usePublications } from './use-publications';
import { PublicationForm } from './publication-form';
import { PublicationCard } from './publication-card';

export function PublicationsPage({ projectId }: { projectId: string }) {
  const state = usePublications(projectId), [editing, setEditing] = useState<PublicationView | undefined>(), [formVersion, setFormVersion] = useState(0);
  const [connector, setConnector] = useState('youtube');
  const done = () => { setEditing(undefined); setFormVersion(value => value + 1); };
  return <ProductPageShell projectId={projectId} workspaceName={state.snapshot?.project.name ?? 'Publishing'} publishing>
    <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--vh-text-2)]"><Send className="size-4" aria-hidden="true" /> From studio to channel</span><h1 className="text-3xl font-semibold tracking-tight">Publish your work</h1><p className="max-w-xl text-sm leading-6 text-[var(--vh-text-2)]">Prepare your media, review every detail, and follow delivery to a connected channel or installed destination.</p></div><div className="flex items-center gap-3"><Link href="/connections" className="text-sm font-medium underline">Connections</Link><Button variant="outline" disabled={state.pending} onClick={() => void state.refresh()}><RefreshCw className={state.loading ? 'animate-spin' : ''} /> Refresh</Button></div></div>
        {!!state.snapshot?.installedConnectors.problems.length && <section aria-label="Connector problems" className="rounded-xl border border-amber-500/30 p-4 text-sm"><h2 className="font-medium">Some installed destinations could not load</h2>{state.snapshot.installedConnectors.problems.map(problem => <p key={problem.location} className="mt-2 break-words text-xs text-[var(--vh-text-2)]">{problem.location}: {problem.message}</p>)}</section>}
        {state.error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">{state.error}</p>}
        {state.loading && !state.snapshot ? <p role="status">Loading publications…</p> : state.snapshot && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div id="publication-form"><PublicationForm key={`${formVersion}-${editing?.id ?? 'new'}-${editing?.revision ?? 0}`} projectId={projectId} connector={connector} onConnector={setConnector} installedConnectors={state.snapshot.installedConnectors.connectors} mediaAssets={state.mediaAssets} instagramAccounts={state.instagramAccounts} accounts={state.accounts?.accounts ?? []} videos={state.videos} pending={state.pending} editing={editing} change={state.change} done={done} /></div>
          <section aria-labelledby="delivery-queue-heading" className="min-w-0 space-y-4"><div className="flex items-center justify-between gap-3"><h2 id="delivery-queue-heading" className="text-lg font-semibold">Review & delivery</h2><span className="text-xs text-[var(--vh-text-2)]">{state.snapshot.publications.length} recent</span></div>
            {state.snapshot.publications.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--vh-border)] p-8 text-center"><p className="font-medium">Your next release starts here</p><p className="mt-2 text-sm leading-6 text-[var(--vh-text-2)]">Saved drafts appear here for review.<br />Nothing uploads until you approve it.</p></div>}
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
      </div>
    </div>
  </ProductPageShell>;
}
