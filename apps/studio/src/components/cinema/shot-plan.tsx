import { Loader2, Sparkles } from 'lucide-react';
import { Action } from '@/components/base/action';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import type { ProductionView, ShotStepView } from './use-cinema';
import { CostTotalText } from '@/components/generation-providers/cost-estimate';
import { m } from '@/paraglide/messages.js';

function settings(step: ShotStepView) {
  const options = (step.parameters.provider_options ?? {}) as Record<string, unknown>;
  return [step.parameters.aspect_ratio, step.parameters.wmDuration, options.resolution, options.generate_audio === true || options.sound === 'on' ? '♪' : null]
    .filter((value): value is string => typeof value === 'string' && value !== 'auto');
}

function Step({ label, step }: { label: string; step: ShotStepView }) {
  const t = useTranslations('AppShell.cinema');
  return <div className="rounded-xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-3">
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--vh-text-3)]">{label}</span>
      <span className="text-sm font-semibold">{step.modelName}</span>
      <span className="text-xs text-[var(--vh-text-3)]">{step.provider}</span>
      {settings(step).map(value => <span key={value} className="rounded-full bg-[var(--vh-control)] px-2 py-0.5 text-[11px]">{value}</span>)}
    </div>
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-[var(--vh-text-2)]">{t('showPrompt', { model: step.modelName })}</summary>
      <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-[var(--vh-control)] p-2.5 text-xs leading-5">{step.prompt}</p>
    </details>
  </div>;
}

/** What the harness will do for this shot, before anything is sent. */
export function ShotPlan({ production, variations, loading, error, describeFirst, busy, onProduce }: {
  production: ProductionView | undefined; variations: number; loading: boolean; error: string | null; describeFirst: boolean; busy: boolean; onProduce: () => void;
}) {
  const t = useTranslations('AppShell.cinema');
  return <section aria-label={t('plan')} className="space-y-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-control)]/40 p-4">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{t('plan')}</h2>{loading && <Loader2 className="size-4 animate-spin text-[var(--vh-text-3)]" />}</div>
    {describeFirst ? <p className="text-xs text-[var(--vh-text-3)]">{t('describeFirst')}</p>
      : error ? <p role="alert" className="break-words text-xs text-red-700">{error}</p>
      : production && <>
        <p className="text-[11px] text-[var(--vh-text-3)]">{t('planHint')}</p>
        {production.still && <Step label={t('planStill')} step={production.still} />}
        <Step label={t('planVideo')} step={production.video} />
        {production.notes.map(note => <p key={note} className="text-xs text-amber-800">{note}</p>)}
        {production.alternatives.video.length > 1 && <p className="text-[11px] text-[var(--vh-text-3)]">{t('alternatives')}: {production.alternatives.video.slice(1, 4).map(item => item.name).join(' · ')}</p>}
      </>}
    {production?.cost && !loading && <p className="text-xs font-semibold">{m['ui.cost.estimate']()} <CostTotalText className="font-normal text-[var(--vh-text-2)]" total={production.cost} /></p>}
    <Action type="button" className="vh-primary flex w-full items-center justify-center gap-2" disabled={busy || loading || describeFirst || Boolean(error) || !production} onClick={onProduce}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {busy ? t('producing') : t('produce', { count: variations })}
    </Action>
    <p className="text-center text-[11px] text-[var(--vh-text-3)]">{t('credits')}</p>
  </section>;
}
