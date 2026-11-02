import { useState } from 'react';
import { Bot } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { ProductPageShell } from '@/components/app/product-page-shell';
import type { AgentAction, ApprovalMode, ApprovalView } from '@/core/agent/contract';
import { cn } from '@/lib/utils';
import { ApprovalCard, formatAgentTime, stepKind } from './approval-card';
import { MemorySection } from './memory-section';
import { useAgentChange, useAgentOverview } from './use-agent';

const STATE_LABEL = { approved: () => m['ui.agent.state_approved'](), rejected: () => m['ui.agent.state_rejected'](), used: () => m['ui.agent.state_used'](), pending: () => '' };

function ModeControl({ mode, disabled, onChange }: { mode?: ApprovalMode; disabled: boolean; onChange: (mode: ApprovalMode) => void }) {
  return <div role="radiogroup" aria-label={m['ui.agent.ask_title']()} className="inline-flex shrink-0 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-1">
    {(['off', 'ask'] as const).map((value) => <Action key={value} role="radio" aria-checked={mode === value} disabled={disabled} onClick={() => mode !== value && onChange(value)}
      className={cn('h-8 rounded-lg px-3.5 text-sm font-semibold transition', mode === value ? 'bg-[var(--vh-surface)] text-[var(--vh-text-1)] shadow-sm' : 'text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]')}>
      {value === 'off' ? m['ui.agent.mode_off']() : m['ui.agent.mode_ask']()}
    </Action>)}
  </div>;
}

function Decided({ approval }: { approval: ApprovalView }) {
  const step = approval.steps[0];
  return <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 text-sm">
    <span className="min-w-0 break-words"><span className="font-semibold">{STATE_LABEL[approval.state]()}</span> · {step?.model ?? (step ? stepKind(step) : '')} · {approval.projectName ?? m['ui.agent.unknown_project']()}</span>
    <time className="text-xs text-[var(--vh-text-2)]" dateTime={approval.decidedAt ?? approval.createdAt}>{formatAgentTime(approval.decidedAt ?? approval.createdAt)}</time>
  </li>;
}

/** Ask-before-generating, the approvals waiting for a person, and what agents remember. */
export function AgentPage() {
  const overview = useAgentOverview();
  const change = useAgentChange();
  const [error, setError] = useState('');
  const data = overview.data, pending = data?.pending ?? [];
  const run = (action: AgentAction) => change.mutateAsync(action).then(() => { setError(''); return true; }, (failure: unknown) => { setError(failure instanceof Error ? failure.message : m['ui.agent.failed']()); return false; });
  return <ProductPageShell workspaceName={m['ui.agent.nav']()}>
    <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="space-y-3">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--vh-text-2)]"><Bot className="size-4" aria-hidden="true" /> {m['ui.agent.nav']()}</span>
          <h1 className="text-3xl font-semibold tracking-tight">{m['ui.agent.title']()}</h1>
          <p className="max-w-xl text-sm leading-6 text-[var(--vh-text-2)]">{m['ui.agent.intro']()}</p>
        </header>
        {(error || overview.error) && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">{error || (overview.error as Error).message}</p>}
        <section aria-labelledby="agent-ask" className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 sm:p-6">
          <div className="min-w-0 max-w-lg space-y-1">
            <h2 id="agent-ask" className="text-lg font-semibold">{m['ui.agent.ask_title']()}</h2>
            <p className="text-sm leading-6 text-[var(--vh-text-2)]">{m['ui.agent.ask_body']()}</p>
          </div>
          <ModeControl mode={data?.mode} disabled={!data || change.isPending} onChange={(mode) => void run({ action: 'set_mode', mode })} />
        </section>
        <section aria-labelledby="agent-waiting" className="space-y-3">
          <h2 id="agent-waiting" className="flex items-center gap-2 text-xl font-semibold">{m['ui.agent.waiting_title']()}
            {pending.length > 0 && <span className="rounded-full bg-[var(--vh-graph-soft)] px-2 py-0.5 text-xs text-[var(--vh-graph-strong)]">{pending.length}</span>}</h2>
          {pending.length === 0
            ? <p className="rounded-2xl border border-dashed border-[var(--vh-border)] p-6 text-center text-sm text-[var(--vh-text-2)]">{data?.mode === 'ask' ? m['ui.agent.waiting_empty']() : m['ui.agent.waiting_off']()}</p>
            : pending.map((approval) => <ApprovalCard key={approval.id} approval={approval} busy={change.isPending} onDecide={(decision) => void run({ action: 'decide', id: approval.id, decision })} />)}
          {(data?.recent.length ?? 0) > 0 && <details className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)]">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{m['ui.agent.recent_title']()}</summary>
            <ul className="divide-y divide-[var(--vh-border)] border-t border-[var(--vh-border)]">{data!.recent.map((approval) => <Decided key={approval.id} approval={approval} />)}</ul>
          </details>}
        </section>
        <MemorySection memory={data?.memory ?? []} busy={change.isPending} onChange={run} />
      </div>
    </div>
  </ProductPageShell>;
}
