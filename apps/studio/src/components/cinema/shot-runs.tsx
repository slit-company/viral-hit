import { CheckCircle2, Loader2, Plus, Repeat2 } from 'lucide-react';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import type { ShotRunView, ShotTakeView } from '@/core/shot-harness/contract';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { cn } from '@/lib/utils';
import { useAddTake, useAssembleBest, useTakeQuality } from './use-cinema';

const VERDICT_TONE = { good: 'bg-emerald-50 text-emerald-800 border-emerald-200', check: 'bg-amber-50 text-amber-800 border-amber-200', retry: 'bg-red-50 text-red-800 border-red-200' } as const;

function Take({ projectId, shot, take, label }: { projectId: string; shot: ShotRunView; take: ShotTakeView; label: string }) {
  const t = useTranslations('AppShell.cinema');
  const quality = useTakeQuality(projectId, take.assetId, shot), add = useAddTake(projectId);
  const pending = ['queued', 'submitting', 'running'].includes(take.state);
  return <figure className="min-w-0 space-y-1.5">
    <div className="relative aspect-video overflow-hidden rounded-xl bg-[var(--vh-control)]">
      {take.url ? <video src={take.url} controls playsInline preload="metadata" className="size-full object-cover" />
        : <div className="grid size-full place-items-center p-3 text-center text-xs text-[var(--vh-text-2)]">{pending ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-4 animate-spin" />{t(take.state === 'queued' ? 'queued' : 'running')}</span> : <span className="break-words text-red-700">{take.error ?? t(take.state === 'canceled' || take.state === 'cancelled' ? 'cancelled' : 'failed')}</span>}</div>}
    </div>
    <figcaption className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-semibold">{label}</span>
      {take.assetId && (quality.data
        ? <span title={quality.data.issues.map(issue => t('issue.' + issue)).join(', ')} className={cn('rounded-full border px-2 py-0.5 text-[11px]', VERDICT_TONE[quality.data.verdict])}>{t(quality.data.verdict)} · {t('score', { score: quality.data.score })}</span>
        : <span className="text-[11px] text-[var(--vh-text-3)]">{quality.isError ? '' : t('checking')}</span>)}
      {quality.data?.issues.map(issue => <span key={issue} className="text-[11px] text-[var(--vh-text-3)]">{t('issue.' + issue)}</span>)}
      {take.assetId && <Action type="button" className="vh-secondary ml-auto inline-flex h-7 items-center gap-1 px-2 text-[11px]" disabled={add.isPending || add.isSuccess} onClick={() => add.mutate(take.assetId!)}>
        {add.isSuccess ? <CheckCircle2 className="size-3.5" /> : <Plus className="size-3.5" />}{add.isSuccess ? t('added') : t('addToTimeline')}
      </Action>}
    </figcaption>
    {add.isError && <p role="alert" className="text-xs text-red-700">{add.error.message}</p>}
  </figure>;
}

/** Every shot with its keyframe and takes side by side, newest first. */
export function ShotRuns({ projectId, shots, loading, onReuseKeyframe }: { projectId: string; shots: ShotRunView[]; loading: boolean; onReuseKeyframe: (assetId: string) => void }) {
  const t = useTranslations('AppShell.cinema');
  const assemble = useAssembleBest(projectId);
  const ready = shots.filter(shot => shot.takes.some(take => take.assetId));
  return <section aria-label={t('runs')} className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{t('runs')}{shots.length ? ' · ' + shots.length : ''}</h2>
      <div className="flex items-center gap-3">
        {ready.length > 0 && <Action type="button" className="vh-secondary inline-flex items-center gap-1.5" disabled={assemble.isPending} onClick={() => assemble.mutate(ready)}>
          {assemble.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{assemble.isPending ? t('assembling') : t('assembleBest')}
        </Action>}
        <Link href={'/editor/' + projectId} className="text-xs font-semibold underline-offset-4 hover:underline">{t('openEditor')}</Link>
      </div>
    </header>
    {assemble.isSuccess && <p role="status" className="text-xs text-emerald-800">{t('assembled', { count: assemble.data })}</p>}
    {assemble.isError && <p role="alert" className="text-xs text-red-700">{assemble.error.message}</p>}
    {!shots.length && (loading
      ? <p role="status" className="inline-flex items-center gap-2 p-4 text-sm text-[var(--vh-text-2)]"><Loader2 className="size-4 animate-spin" />{t('loadingRuns')}</p>
      : <div className="rounded-2xl border border-dashed border-[var(--vh-border)] p-10 text-center text-sm text-[var(--vh-text-2)]">{t('emptyRuns')}</div>)}
    {shots.map(shot => <article key={shot.runId} className="space-y-3 rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4">
      <p className="line-clamp-2 text-sm leading-6">{shot.prompt}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shot.still && <figure className="min-w-0 space-y-1.5">
          <div className="aspect-video overflow-hidden rounded-xl bg-[var(--vh-control)]">{shot.still.url ? <img src={shot.still.url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-xs text-[var(--vh-text-2)]">{shot.still.state === 'failed' ? <span className="p-3 text-red-700">{shot.still.error}</span> : <Loader2 className="size-4 animate-spin" />}</div>}</div>
          <figcaption className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">{t('keyframe')}
            {shot.still.assetId && <Action type="button" title={t('reuseKeyframeHint')} className="vh-secondary ml-auto inline-flex h-7 items-center gap-1 px-2 text-[11px]" onClick={() => onReuseKeyframe(shot.still!.assetId!)}>
              <Repeat2 className="size-3.5" />{t('reuseKeyframe')}
            </Action>}
          </figcaption>
        </figure>}
        {shot.takes.map((take, index) => <Take key={take.jobId} projectId={projectId} shot={shot} take={take} label={t('take', { number: index + 1 })} />)}
      </div>
    </article>)}
  </section>;
}
