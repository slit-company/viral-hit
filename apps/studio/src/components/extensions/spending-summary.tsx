import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Receipt } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { NativeSelect } from '@/components/ui/native-select';
import { apiJsonGet } from '@/lib/api-client';
import type { SpendingView } from '@/core/costs/spending.server';
import { CostTotalText, formatCost } from '@/components/generation-providers/cost-estimate';

const STATUS: Record<string, () => string> = { succeeded: () => m['ui.spending.done'](), failed: () => m['ui.spending.failed_status'](), pending: () => m['ui.spending.running'](), processing: () => m['ui.spending.running']() };

/** Estimated spending from the generation history, per service and per generation. */
export function SpendingSummary() {
  const [days, setDays] = useState(30);
  const spending = useQuery({ queryKey: ['spending', days], queryFn: () => apiJsonGet<SpendingView>('/api/app/spending?days=' + days) });
  const data = spending.data;
  return <section aria-label={m['ui.spending.title']()} className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1.5">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><Receipt size={20} aria-hidden="true" />{m['ui.spending.title']()}</h2>
        <p className="max-w-2xl text-sm leading-6 text-[var(--vh-text-2)]">{m['ui.spending.description']()}</p>
      </div>
      <NativeSelect aria-label={m['ui.spending.period']()} className="w-40" value={String(days)} onChange={event => setDays(Number(event.target.value))}>
        {[7, 30, 90].map(count => <option key={count} value={count}>{m['ui.spending.days']({ count })}</option>)}
      </NativeSelect>
    </div>
    {data && (data.generations === 0 ? <p className="text-sm text-[var(--vh-text-2)]">{m['ui.spending.empty']()}</p> : <>
      <div className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4">
        <p className="text-sm font-semibold">{m['ui.spending.total']()} <CostTotalText className="font-normal" total={data.total} /></p>
        <p className="text-xs text-[var(--vh-text-2)]">{m['ui.spending.counts']({ generations: data.generations, failed: data.failed })}</p>
        <ul className="mt-3 divide-y divide-[var(--vh-border)] text-sm">
          {data.services.map(service => <li key={service.providerId} className="flex items-center justify-between gap-3 py-2">
            <span className="font-medium">{service.label}</span>
            <span className="text-right text-xs text-[var(--vh-text-2)]">{service.total.totals.length > 0 || service.total.unpriced > 0 ? <><CostTotalText total={service.total} />{' · '}</> : null}{m['ui.spending.counts']({ generations: service.generations, failed: service.failed })}</span>
          </li>)}
        </ul>
      </div>
      <details className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4 text-sm">
        <summary className="cursor-pointer font-semibold">{m['ui.spending.recent']()}</summary>
        <ul className="mt-3 space-y-2">
          {data.recent.map(row => <li key={row.id} className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate"><span className="font-medium">{row.modelName}</span>{row.agent && <Bot size={12} aria-label={m['ui.spending.agent']()} className="ml-1 inline align-[-2px]" />}</span>
            <span className="shrink-0 text-[var(--vh-text-2)]">{STATUS[row.status]?.() ?? row.status} · {row.cost ? formatCost(row.cost) : m['ui.cost.unpriced']()} · {new Date(row.createdAt).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' })}</span>
          </li>)}
        </ul>
      </details>
    </>)}
  </section>;
}
