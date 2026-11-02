import { ArrowRightToLine, CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Repeat2 } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import type { ShotRunView, ShotTakeView } from '@/core/shot-harness/contract';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { cn } from '@/lib/utils';
import { faceReferences, useAddTake, useAssembleBest, useTakeFace, useTakeQuality } from './use-cinema';
import type { FaceMatchResult } from '@/core/characters/face-match';
import { FACE_MATCH_THRESHOLD } from '@/core/characters/face-match';

const VERDICT_TONE = { good: 'bg-emerald-50 text-emerald-800 border-emerald-200', check: 'bg-amber-50 text-amber-800 border-amber-200', retry: 'bg-red-50 text-red-800 border-red-200' } as const;
const FACE_TONE = { match: VERDICT_TONE.good, mixed: VERDICT_TONE.check, different: VERDICT_TONE.retry, 'no-face': 'border-[var(--vh-border)] text-[var(--vh-text-2)]' } as const;
const score = (value: number | null) => value === null ? '–' : value.toFixed(2);

/** How closely the take keeps the shot's person, measured locally frame by frame. */
function FaceChip({ face }: { face: FaceMatchResult }) {
  const label = face.status === 'match' ? m['ui.cinema.face_match']({ score: score(face.similarity) })
    : face.status === 'mixed' ? m['ui.cinema.face_mixed']({ matched: face.matchedFrames, faced: face.facedFrames })
    : face.status === 'different' ? m['ui.cinema.face_different']({ score: score(face.similarity) }) : m['ui.cinema.face_none']();
  const detail = face.facedFrames ? m['ui.cinema.face_detail']({ score: score(face.similarity), threshold: FACE_MATCH_THRESHOLD, matched: face.matchedFrames, faced: face.facedFrames, lowest: score(face.lowest?.similarity ?? null) }) : undefined;
  return <span title={detail} className={cn('rounded-full border px-2 py-0.5 text-[11px]', FACE_TONE[face.status])}>{label}</span>;
}

export type ShotRunActions = {
  onReuseKeyframe: (assetId: string) => void;
  onRenderAgain: (shot: ShotRunView) => void;
  onEdit: (shot: ShotRunView) => void;
  onContinue: (shot: ShotRunView, take: ShotTakeView) => void;
  /** Take asset whose last frame is being prepared. */
  continuing: string | null;
  busy: boolean;
};

function Take({ projectId, shot, take, label, actions }: { projectId: string; shot: ShotRunView; take: ShotTakeView; label: string; actions: ShotRunActions }) {
  const t = useTranslations('AppShell.cinema');
  const quality = useTakeQuality(projectId, take.assetId, shot), add = useAddTake(projectId), face = useTakeFace(projectId, take.assetId, shot);
  const pending = ['queued', 'submitting', 'running'].includes(take.state);
  return <figure className="min-w-0 space-y-1.5">
    <div className="relative aspect-video overflow-hidden rounded-xl bg-[var(--vh-control)]">
      {take.url ? <video src={take.url} controls playsInline preload="metadata" className="size-full object-cover" />
        : <div className="grid size-full place-items-center p-3 text-center text-xs text-[var(--vh-text-2)]">{pending ? <span className="inline-flex items-center gap-1.5"><Loader2 className="size-4 animate-spin" />{t(take.state === 'queued' ? 'queued' : 'running')}</span> : <span className="break-words text-red-700">{take.error ?? t(take.state === 'canceled' || take.state === 'cancelled' ? 'cancelled' : 'failed')}</span>}</div>}
    </div>
    <figcaption className="space-y-1.5 text-xs">
      {/* Checks on one line, actions on the next, so narrow takes wrap predictably. */}
      <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-semibold">{label}</span>
      {take.assetId && (quality.data
        ? <span title={quality.data.issues.map(issue => t('issue.' + issue)).join(', ')} className={cn('rounded-full border px-2 py-0.5 text-[11px]', VERDICT_TONE[quality.data.verdict])}>{t(quality.data.verdict)} · {t('score', { score: quality.data.score })}</span>
        : <span className="text-[11px] text-[var(--vh-text-3)]">{quality.isError ? '' : t('checking')}</span>)}
      {quality.data?.issues.map(issue => <span key={issue} className="text-[11px] text-[var(--vh-text-3)]">{t('issue.' + issue)}</span>)}
      {take.assetId && faceReferences(shot).length > 0 && (face.data ? <FaceChip face={face.data} />
        : <span title={face.error?.message} className="text-[11px] text-[var(--vh-text-3)]">{face.isError ? m['ui.cinema.face_unavailable']() : m['ui.cinema.face_checking']()}</span>)}
      </div>
      {take.assetId && <div className="flex flex-wrap gap-1.5">
      <Action type="button" className="vh-secondary inline-flex h-7 items-center gap-1 px-2 text-[11px]" disabled={add.isPending || add.isSuccess} onClick={() => add.mutate(take.assetId!)}>
        {add.isSuccess ? <CheckCircle2 className="size-3.5" /> : <Plus className="size-3.5" />}{add.isSuccess ? t('added') : t('addToTimeline')}
      </Action>
      <Action type="button" title={m['ui.cinema.continue_hint']()} className="vh-secondary inline-flex h-7 items-center gap-1 px-2 text-[11px]"
        disabled={actions.busy || actions.continuing !== null} onClick={() => actions.onContinue(shot, take)}>
        {actions.continuing === take.assetId ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRightToLine className="size-3.5" />}{m['ui.cinema.continue_take']()}
      </Action>
      </div>}
    </figcaption>
    {add.isError && <p role="alert" className="text-xs text-red-700">{add.error.message}</p>}
  </figure>;
}

/** Every shot with its keyframe and takes side by side, newest first. */
export function ShotRuns({ projectId, shots, loading, actions }: { projectId: string; shots: ShotRunView[]; loading: boolean; actions: ShotRunActions }) {
  const t = useTranslations('AppShell.cinema');
  const assemble = useAssembleBest(projectId);
  const ready = shots.filter(shot => shot.takes.some(take => take.assetId));
  const sequenced = (shot: ShotRunView) => shot.position > 1 || shot.attempt > 1 || shots.some(other => other.sequenceId === shot.sequenceId && other.runId !== shot.runId);
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
      <div className="flex flex-wrap items-start gap-2">
        {sequenced(shot) && <span className="rounded-full bg-[var(--vh-control)] px-2 py-0.5 text-[11px] font-semibold">
          {m['ui.cinema.shot_label']({ position: shot.position })}{shot.attempt > 1 ? ' · ' + m['ui.cinema.attempt_label']({ attempt: shot.attempt }) : ''}
        </span>}
        <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-6">{shot.prompt}</p>
        {shot.spec && <div className="flex shrink-0 gap-1.5">
          <Action type="button" className="vh-secondary inline-flex h-7 items-center gap-1 px-2 text-[11px]" disabled={actions.busy} onClick={() => actions.onEdit(shot)}>
            <Pencil className="size-3.5" />{m['ui.cinema.edit_shot']()}
          </Action>
          <Action type="button" className="vh-secondary inline-flex h-7 items-center gap-1 px-2 text-[11px]" disabled={actions.busy} onClick={() => actions.onRenderAgain(shot)}>
            <RefreshCw className="size-3.5" />{m['ui.cinema.render_again']()}
          </Action>
        </div>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shot.still && <figure className="min-w-0 space-y-1.5">
          <div className="aspect-video overflow-hidden rounded-xl bg-[var(--vh-control)]">{shot.still.url ? <img src={shot.still.url} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-xs text-[var(--vh-text-2)]">{shot.still.state === 'failed' ? <span className="p-3 text-red-700">{shot.still.error}</span> : <Loader2 className="size-4 animate-spin" />}</div>}</div>
          <figcaption className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">{t('keyframe')}
            {shot.still.assetId && <Action type="button" title={t('reuseKeyframeHint')} className="vh-secondary ml-auto inline-flex h-7 items-center gap-1 px-2 text-[11px]" onClick={() => actions.onReuseKeyframe(shot.still!.assetId!)}>
              <Repeat2 className="size-3.5" />{t('reuseKeyframe')}
            </Action>}
          </figcaption>
        </figure>}
        {shot.takes.map((take, index) => <Take key={take.jobId} projectId={projectId} shot={shot} take={take} label={t('take', { number: index + 1 })} actions={actions} />)}
      </div>
    </article>)}
  </section>;
}
