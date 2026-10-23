import { useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { Action } from '@/components/base/action';
import { formatChange, formatMetric, metricLabel } from './performance-format';
import { PerformanceEntryDialog } from './performance-entry-dialog';
import type { PerformanceItem, usePerformance } from './use-performance';

const issues = { 'permission-missing': 'The account has not granted access to these numbers.', 'not-found': 'No numbers are available yet.', unavailable: 'The destination did not answer. Try again later.' } as const;

function PerformanceRow({ item, metrics, top, state }: { item: PerformanceItem; metrics: string[]; top: boolean; state: ReturnType<typeof usePerformance> }) {
  const [entering, setEntering] = useState(false), busy = state.busy === item.publicationId, attempt = item.lastAttempt;
  return <li className="grid gap-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_auto] sm:items-center">
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-2"><h3 className="truncate font-semibold">{item.title}</h3>{top && <span className="rounded-full bg-[var(--color-brand-lime)] px-2 py-0.5 text-[11px] font-semibold text-black">Top</span>}</div>
      <p className="text-xs text-[var(--vh-text-2)]">{item.destination}{item.latest ? ' · updated ' + new Date(item.latest.observedAt).toLocaleString() + (item.latest.source === 'manual' ? ' · entered by hand' : '') : ' · no numbers yet'}</p>
      {attempt?.state === 'unavailable' && attempt.issue && <p role="status" className="text-xs text-[var(--vh-text-2)]">{issues[attempt.issue]}</p>}
      {item.latest?.state === 'partial' && <p className="text-xs text-[var(--vh-text-2)]">Not reported: {item.latest.missing.map(metricLabel).join(', ')}</p>}
    </div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {metrics.map(name => { const value = item.latest?.metrics[name], change = item.change[name]; return <div key={name} className="min-w-0">
        <dt className="truncate text-xs text-[var(--vh-text-2)]">{metricLabel(name)}</dt>
        <dd className="text-lg font-semibold tabular-nums">{value === undefined ? '—' : formatMetric(value)}{change !== undefined && change !== 0 && <span className="ml-1 text-xs font-medium text-[var(--vh-text-2)]">{formatChange(change)}</span>}</dd>
      </div>; })}
    </dl>
    <div className="flex flex-wrap gap-2 sm:justify-end">
      {item.canCollect && <Action className="vh-secondary" disabled={Boolean(state.busy)} onClick={() => void state.change({ action: 'collect', publicationId: item.publicationId })}><RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" /> Update</Action>}
      {item.canRecord && <Action className="vh-secondary" disabled={Boolean(state.busy)} onClick={() => setEntering(true)}>Enter numbers</Action>}
    </div>
    {entering && <PerformanceEntryDialog item={item} open={entering} onOpenChange={setEntering} pending={busy} change={state.change} />}
  </li>;
}

/** Performance of delivered posts, best first by the leading shared measure. */
export function PerformanceSection({ state }: { state: ReturnType<typeof usePerformance> }) {
  const snapshot = state.snapshot;
  if (!snapshot) return state.error ? <p role="alert" className="text-sm">{state.error}</p> : null;
  const metrics = snapshot.metrics.slice(0, 4), lead = metrics[0];
  const items = [...snapshot.items].sort((a, b) => (b.latest?.metrics[lead] ?? -1) - (a.latest?.metrics[lead] ?? -1));
  const top = lead && items.filter(item => item.latest?.metrics[lead] !== undefined).length > 1 ? items[0].publicationId : null;
  return <section aria-labelledby="performance-heading" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div className="space-y-1"><h2 id="performance-heading" className="inline-flex items-center gap-2 text-lg font-semibold"><BarChart3 className="size-5" aria-hidden="true" /> Performance</h2><p className="text-sm text-[var(--vh-text-2)]">See how each delivered post is doing. Every update is kept, so you can compare over time.</p></div></div>
    {state.error && <p role="alert" className="rounded-xl border border-destructive/30 p-3 text-sm">{state.error}</p>}
    {items.length === 0 ? <div className="rounded-2xl border border-dashed border-[var(--vh-border)] p-8 text-center text-sm text-[var(--vh-text-2)]">Delivered posts appear here with their views, likes and other numbers.</div>
      : <ul className="space-y-3">{items.map(item => <PerformanceRow key={item.publicationId} item={item} metrics={metrics} top={item.publicationId === top} state={state} />)}</ul>}
  </section>;
}
