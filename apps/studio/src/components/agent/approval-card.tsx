import { Check, X } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { Button } from '@/components/ui/button';
import type { ApprovalStep, ApprovalView } from '@/core/agent/contract';
import { sumCosts } from '@/core/costs/pricing';
import { CostTotalText, formatCost } from '@/components/generation-providers/cost-estimate';

export const formatAgentTime = (iso: string) => new Date(iso).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });
const MODE_LABEL: Record<string, () => string> = {
  image: () => m['ui.agent.kind_image'](), video: () => m['ui.agent.kind_video'](), audio: () => m['ui.agent.kind_audio'](), analysis: () => m['ui.agent.kind_analysis'](),
};
/** The kind of output in the reader's language, or the step's own label (a product or adapter name). */
export const stepKind = (step: ApprovalStep) => (step.mode && MODE_LABEL[step.mode] ? MODE_LABEL[step.mode]() : step.label);

/** One generation an agent asked for: what it will make, and the person's decision. */
export function ApprovalCard({ approval, busy, onDecide }: { approval: ApprovalView; busy: boolean; onDecide: (decision: 'approve' | 'reject') => void }) {
  const project = approval.projectName ?? m['ui.agent.unknown_project']();
  return <article aria-label={m['ui.agent.approval_label']({ project })} className="space-y-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5">
    <div className="space-y-1">
      <p className="text-sm font-semibold">{project}</p>
      <p className="text-xs text-[var(--vh-text-2)]">{m['ui.agent.requested']({ tool: approval.tool })} · <time dateTime={approval.createdAt}>{formatAgentTime(approval.createdAt)}</time></p>
    </div>
    <ul className="space-y-2">
      {approval.steps.map((step, index) => <li key={index} className="rounded-xl bg-[var(--vh-control)] p-3 text-sm">
        <p className="font-semibold break-words">{step.model ?? stepKind(step)}</p>
        {step.model && <p className="text-xs text-[var(--vh-text-2)]">{stepKind(step)}{step.cost ? ' · ' + m['ui.cost.about']({ amount: formatCost(step.cost) }) : step.cost === null ? ' · ' + m['ui.cost.unpriced']() : ''}</p>}
        {step.prompt && <p className="mt-1.5 line-clamp-3 break-words text-[var(--vh-text-2)]">{step.prompt}</p>}
      </li>)}
    </ul>
    {approval.steps.some(step => step.cost !== undefined) && <p className="text-sm font-semibold">{m['ui.cost.estimate']()} <CostTotalText className="font-normal text-[var(--vh-text-2)]" total={sumCosts(approval.steps.filter(step => step.cost !== undefined).map(step => step.cost ?? null))} /></p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={busy} onClick={() => onDecide('approve')}><Check aria-hidden="true" /> {m['ui.agent.approve']()}</Button>
      <Button variant="outline" disabled={busy} onClick={() => onDecide('reject')}><X aria-hidden="true" /> {m['ui.agent.reject']()}</Button>
      <p className="text-xs text-[var(--vh-text-2)]">{approval.kind === 'run' ? m['ui.agent.run_note']() : m['ui.agent.request_note']()}</p>
    </div>
  </article>;
}
