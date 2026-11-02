import { useEffect, useState } from 'react';
import { GitBranch, Loader2, Play } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { cn } from '@/lib/utils';
import { creativeCanvasPanelClassName } from './creative-canvas-theme';
import { useCanvasRunActions, useCanvasRunStatus, type CanvasRunPlanView, type CanvasRunStepView } from './use-canvas-runs';

const REASON: Record<NonNullable<CanvasRunStepView['reason']>, () => string> = {
  'no-result': () => m['ui.canvas_run.reason_no_result'](), settings: () => m['ui.canvas_run.reason_settings'](),
  inputs: () => m['ui.canvas_run.reason_inputs'](), upstream: () => m['ui.canvas_run.reason_upstream'](),
};
const button = 'inline-flex h-8 items-center gap-1.5 rounded-[11px] px-2.5 text-[12px] font-semibold text-[var(--creative-canvas-ink-soft)] transition hover:bg-[var(--vh-control)] hover:text-[var(--creative-canvas-ink)] disabled:opacity-45';

/** Keeps canvas takes in step with their durable runs while the canvas is open. */
export function CanvasRunSync({ projectId }: { projectId: string }) {
  useCanvasRunStatus(projectId);
  return null;
}

/** Branch and run-what-changed for the selected generation card, with the plan shown before anything runs. */
export function CanvasRunActions({ projectId, cardId, lowered }: { projectId: string; cardId: string; lowered: boolean }) {
  const status = useCanvasRunStatus(projectId), actions = useCanvasRunActions(projectId);
  const [plan, setPlan] = useState<CanvasRunPlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { setPlan(null); setNotice(''); }, [cardId]);
  const running = status.data?.runs.some((run) => run.steps.some((step) => step.cardId === cardId && (step.state === 'pending' || step.state === 'processing')));
  const toRun = plan?.steps.filter((step) => step.action === 'run') ?? [];
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (error) { setPlan(null); setNotice(error instanceof Error ? error.message : m['ui.canvas_run.failed']()); } finally { setBusy(false); }
  };
  return <section aria-label={m['ui.canvas_run.label']()} className={cn('pointer-events-auto absolute left-1/2 z-30 w-max max-w-[min(92vw,30rem)] -translate-x-1/2 space-y-2', lowered ? 'top-16' : 'top-4')}>
    <div className={cn('mx-auto flex w-max items-center gap-1 rounded-[20px] px-2 py-1.5', creativeCanvasPanelClassName)}>
      <Action type="button" className={button} disabled={busy} title={m['ui.canvas_run.branch_hint']()}
        onClick={() => void act(async () => { setPlan(null); await actions.branch(cardId); setNotice(m['ui.canvas_run.branched']()); })}>
        <GitBranch className="size-4" strokeWidth={2.1} />{m['ui.canvas_run.branch']()}
      </Action>
      <Action type="button" className={button} disabled={busy || running} aria-expanded={Boolean(plan)} title={m['ui.canvas_run.run_hint']()}
        onClick={() => void act(async () => { setNotice(''); setPlan(await actions.plan(cardId)); })}>
        {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" strokeWidth={2.1} />}{running ? m['ui.canvas_run.running']() : m['ui.canvas_run.run_changed']()}
      </Action>
    </div>
    {plan && <div role="dialog" aria-label={m['ui.canvas_run.plan_title']()} className={cn('space-y-3 rounded-2xl p-4 text-xs', creativeCanvasPanelClassName)}>
      <p className="text-sm font-semibold">{m['ui.canvas_run.plan_title']()}</p>
      {plan.blocked ? <p role="alert">{plan.blocked.message}</p> : <ol className="space-y-1.5">
        {plan.steps.map((step) => <li key={step.cardId} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--vh-control)] px-3 py-2">
          <span className="min-w-0"><span className="block truncate font-semibold">{step.name}</span><span className="block truncate text-[var(--vh-text-2)]">{step.modelId}</span></span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 font-semibold', step.action === 'run' ? 'bg-[var(--vh-graph-soft)] text-[var(--vh-graph-strong)]' : 'text-[var(--vh-text-2)]')}>
            {step.action === 'run' ? REASON[step.reason!]() : m['ui.canvas_run.reuses']()}
          </span>
        </li>)}
      </ol>}
      {!plan.blocked && !toRun.length && <p role="status">{m['ui.canvas_run.up_to_date']()}</p>}
      <div className="flex justify-end gap-2">
        <Action type="button" className="vh-secondary h-8 px-3 text-xs" onClick={() => setPlan(null)}>{m['ui.canvas_run.cancel']()}</Action>
        {!plan.blocked && toRun.length > 0 && <Action type="button" className="vh-primary h-8 px-3 text-xs" disabled={busy}
          onClick={() => void act(async () => { await actions.start(cardId); setPlan(null); })}>{m['ui.canvas_run.confirm']({ count: toRun.length })}</Action>}
      </div>
    </div>}
    {notice && <p role="status" className={cn('mx-auto w-max max-w-full rounded-xl px-3 py-2 text-xs', creativeCanvasPanelClassName)}>{notice}</p>}
  </section>;
}
