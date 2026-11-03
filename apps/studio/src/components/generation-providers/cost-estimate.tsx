import { useMemo } from 'react';
import { costRequest, estimateCost, sumCosts, unitRate, type CostEstimate, type CostTotal } from '@/core/costs/pricing';
import { resolveModelOptions, type ModelOptionsDraft } from '@/core/generation-providers/model-controls';
import { useWorkspaceModels } from '@/core/workspace-hooks/use-workspace-metadata';
import { m } from '@/paraglide/messages.js';
import { cn } from '@/lib/utils';

export function formatCost(estimate: CostEstimate) {
  if (estimate.currency === 'USD') {
    if (estimate.amount > 0 && estimate.amount < 0.01) return '<$0.01';
    return '$' + (estimate.amount >= 100 ? Math.round(estimate.amount).toLocaleString('en-US') : estimate.amount.toFixed(2));
  }
  const count = Math.ceil(estimate.amount).toLocaleString('en-US');
  return m['ui.cost.characters']({ count });
}

/** "About $0.79", with how the estimate was made on hover. Unpriced steps are counted, never guessed. */
export function CostTotalText({ total, checked, className }: { total: CostTotal; checked?: string | null; className?: string }) {
  if (!total.totals.length) return total.unpriced ? <span className={className}>{m['ui.cost.unpriced']()}</span> : null;
  const average = total.totals.some(item => item.basis === 'average');
  const hint = checked ? (average ? m['ui.cost.basis_average']({ date: checked }) : m['ui.cost.basis_list']({ date: checked })) : undefined;
  return <span className={className} title={hint}>
    {m['ui.cost.about']({ amount: total.totals.map(formatCost).join(' + ') })}
    {total.unpriced ? ' ' + m['ui.cost.plus_unpriced']({ count: total.unpriced }) : ''}
  </span>;
}

type CostInput = { duration?: string | null; prompt?: string | null; options?: ModelOptionsDraft | null; sourceSeconds?: number | null; outputs?: number };

/** The estimate for one model and request, from the model's published price and its option defaults. */
export function useModelCost(modelId: string | null | undefined, input: CostInput) {
  const { data } = useWorkspaceModels();
  const model = modelId ? data?.models.find(item => item.id === modelId) : undefined;
  const { duration, prompt, options, sourceSeconds, outputs = 1 } = input;
  return useMemo(() => {
    if (!model) return null;
    if (!model.pricing) return { model, total: { totals: [], unpriced: 1 } satisfies CostTotal };
    let values: Record<string, unknown>;
    try { values = resolveModelOptions(model.controls, options?.modelId === model.id ? options.values : undefined); }
    catch { values = options?.modelId === model.id ? options.values : {}; }
    const one = estimateCost(model.pricing, costRequest({ duration, defaultDuration: model.defaultDuration, sourceSeconds, prompt, options: values }));
    // Per-second prices for a source of unknown length show the rate instead of a total.
    const rate = !one && model.pricing.per === 'second' ? unitRate(model.pricing, values) : null;
    return { model, total: sumCosts(Array.from({ length: Math.max(1, outputs) }, () => one)), rate };
  }, [model, duration, prompt, options, sourceSeconds, outputs]);
}

export function ModelCostEstimate({ modelId, className, ...input }: CostInput & { modelId: string | null | undefined; className?: string }) {
  const cost = useModelCost(modelId, input);
  if (!cost) return null;
  if (cost.rate) return <span title={m['ui.cost.basis_list']({ date: cost.model.pricing?.checked ?? '' })} className={cn('text-[10px] font-medium tabular-nums text-[var(--vh-text-2)]', className)}>{m['ui.cost.per_second']({ amount: formatCost(cost.rate) })}</span>;
  return <CostTotalText total={cost.total} checked={cost.model.pricing?.checked} className={cn('text-[10px] font-medium tabular-nums text-[var(--vh-text-2)]', className)} />;
}
