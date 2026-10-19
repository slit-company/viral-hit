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
  const done = () => { setEditing(undefined); setFormVersion(value => value + 1); };
  return <ProductPageShell projectId={projectId} workspaceName={state.snapshot?.project.name ?? 'Publishing'} publishing>
    <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--vh-text-2)]"><Send className="size-4" aria-hidden="true" /> From studio to channel</span><h1 className="text-3xl font-semibold tracking-tight">Publish your work</h1><p className="max-w-xl text-sm leading-6 text-[var(--vh-text-2)]">Prepare a video, review every detail, and follow its delivery to YouTube.</p></div><div className="flex items-center gap-3"><Link href="/connections" className="text-sm font-medium underline">Connections</Link><Button variant="outline" disabled={state.pending} onClick={() => void state.refresh()}><RefreshCw className={state.loading ? 'animate-spin' : ''} /> Refresh</Button></div></div>
        {state.error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">{state.error}</p>}
        {state.loading && !state.snapshot ? <p role="status">Loading publications…</p> : state.snapshot && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div id="publication-form"><PublicationForm key={`${formVersion}-${editing?.id ?? 'new'}-${editing?.revision ?? 0}`} projectId={projectId} accounts={state.accounts?.accounts ?? []} videos={state.videos} pending={state.pending} editing={editing} change={state.change} done={done} /></div>
          <section aria-labelledby="delivery-queue-heading" className="min-w-0 space-y-4"><div className="flex items-center justify-between gap-3"><h2 id="delivery-queue-heading" className="text-lg font-semibold">Review & delivery</h2><span className="text-xs text-[var(--vh-text-2)]">{state.snapshot.publications.length} recent</span></div>
            {state.snapshot.publications.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--vh-border)] p-8 text-center"><p className="font-medium">Your next release starts here</p><p className="mt-2 text-sm leading-6 text-[var(--vh-text-2)]">Saved drafts appear here for review.<br />Nothing uploads until you approve it.</p></div>}
            {state.snapshot.publications.map(item => { const account = state.accounts?.accounts.find(value => value.id === item.accountId); return <PublicationCard key={`${item.id}-${item.revision}-${item.digest}`} item={item} channelTitle={account?.channelTitle} canApprove={state.snapshot!.configured && account?.status === 'connected' && account.channelId === item.destinationId} pending={state.pending} change={state.change} edit={() => { setEditing(item); document.getElementById('publication-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />; })}
          </section>
        </div>}
      </div>
    </div>
  </ProductPageShell>;
}
