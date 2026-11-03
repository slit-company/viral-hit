import { useState } from 'react';
import { Download, Loader2, Plus, Shapes } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';
import { Action } from '@/components/base/action';
import { Link } from '@/core/i18n/navigation';
import { addProjectAssetToTimeline } from '@/core/editor/timeline-client';
import type { SwapVerdict } from '@/core/character-swap/contract';
import type { ShapeshiftVariation, ShapeshiftView } from '@/core/shapeshift/contract';
import { apiJsonGet } from '@/lib/api-client';
import type { RecentAsset } from '@/core/workspace-lib/app/workspace-client-api';
import { cn } from '@/lib/utils';
import { MODE_LABELS, STYLE_LABELS } from './shapeshift-fields';
import { pieceFailed, useAutoFinish, useShapeshifts } from './use-shapeshift';

const FACE: Partial<Record<SwapVerdict, () => string>> = { swapped: () => m['ui.shapeshift.face_swapped'](), blended: () => m['ui.shapeshift.face_blended'](), kept: () => m['ui.shapeshift.face_kept']() };
const badge = 'rounded-full bg-[var(--vh-control)] px-2 py-0.5 font-semibold';

/** Every run of this project, newest first; each variation shows its progress, then the joined result and its scores. */
export function ShapeshiftRuns({ projectId }: { projectId: string }) {
  const runs = useShapeshifts(projectId), { joining, errors } = useAutoFinish(projectId, runs.data);
  return <section aria-label={m['ui.shapeshift.runs']()} className="min-w-0 bg-[var(--vh-bg)] lg:overflow-y-auto">
    <header className="flex items-center justify-between gap-3 border-b border-[var(--vh-border)] px-5 py-3">
      <h2 className="text-sm font-semibold">{m['ui.shapeshift.runs']()}{runs.data?.length ? ' · ' + runs.data.length : ''}</h2>
      <Link href={'/editor/' + projectId} className="text-xs font-semibold underline-offset-4 hover:underline">{m['studio.tools.open_editor_link']()}</Link>
    </header>
    <div className="space-y-4 p-4 sm:p-6">
      {runs.isError && <p role="alert" className="text-sm text-red-700">{m['ui.shapeshift.load_failed']()} <Action type="button" className="underline" onClick={() => void runs.refetch()}>{m['ui.shapeshift.try_again']()}</Action></p>}
      {runs.data?.length ? runs.data.map(run => <RunCard key={run.requestId} projectId={projectId} run={run} joining={joining.includes(run.requestId)} error={errors[run.requestId]} />)
        : !runs.isPending && <div className="mx-auto max-w-md space-y-3 py-16 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[var(--color-brand-lime-soft)] text-[var(--color-lime-text)]"><Shapes className="size-5" /></div>
          <h3 className="text-lg font-semibold">{m['ui.shapeshift.runs_empty_title']()}</h3>
          <p className="text-sm leading-6 text-[var(--vh-text-2)]">{m['ui.shapeshift.runs_empty_body']()}</p>
        </div>}
    </div>
  </section>;
}

function RunCard({ projectId, run, joining, error }: { projectId: string; run: ShapeshiftView; joining: boolean; error?: string }) {
  return <article className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)] p-4 shadow-sm">
    <header className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <span className={badge}>{MODE_LABELS[run.mode]()}</span>
      {run.style !== 'none' && <span className={badge}>{STYLE_LABELS[run.style]()}</span>}
      <span className="tabular-nums text-[var(--vh-text-2)]">{m['ui.shapeshift.range_summary']({ start: run.start.toFixed(1), end: (run.start + run.duration).toFixed(1), length: run.duration.toFixed(1) })}</span>
      <time className="ml-auto text-[var(--vh-text-3)]" dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleString(getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
    </header>
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
      {run.sourceUrl && <figure className="min-w-0 space-y-2 rounded-xl border border-dashed border-[var(--vh-border)] p-2">
        <video src={run.sourceUrl + '#t=' + run.start.toFixed(2)} muted controls playsInline preload="metadata" className="aspect-video w-full rounded-lg bg-black object-contain" />
        <figcaption className="px-0.5 text-xs font-semibold text-[var(--vh-text-2)]">{m['ui.shapeshift.source_label']()}</figcaption>
      </figure>}
      {run.variations.map(variation => <VariationTile key={variation.index} projectId={projectId} variation={variation} joining={joining} error={error} />)}
    </div>
  </article>;
}

function VariationTile({ projectId, variation, joining, error }: { projectId: string; variation: ShapeshiftVariation; joining: boolean; error?: string }) {
  const done = variation.pieces.filter(piece => piece.outputAssetId).length, total = variation.pieces.length;
  const stopped = variation.pieces.find(piece => pieceFailed(piece.state)), joinError = !variation.resultAssetId && done === total && !joining ? error : undefined;
  return <figure className={cn('min-w-0 space-y-2 rounded-xl border p-2', variation.best ? 'border-[var(--vh-text-1)] shadow-[0_0_0_1px_var(--vh-text-1)]' : 'border-[var(--vh-border)]')}>
    <div className="relative aspect-video overflow-hidden rounded-lg bg-[var(--vh-control)]">
      {variation.resultUrl ? <video src={variation.resultUrl} controls playsInline preload="metadata" className="size-full bg-black object-contain" />
        : <div className="grid size-full place-items-center p-3 text-center text-[11px] text-[var(--vh-text-2)]">
          {stopped || joinError ? <span className="text-red-700">{m['ui.shapeshift.failed']()}</span>
            : <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" />{done === total ? m['ui.shapeshift.joining']() : m['ui.shapeshift.making']({ done, total })}</span>}
        </div>}
      {variation.best && <span className="absolute left-2 top-2 rounded-full bg-[var(--vh-text-1)] px-2 py-0.5 text-[10px] font-bold text-[var(--vh-bg)]">{m['ui.shapeshift.best']()}</span>}
    </div>
    <figcaption className="space-y-1.5 px-0.5">
      <p className="truncate text-xs font-semibold" title={variation.modelName}>{variation.modelName}</p>
      {variation.scores && <p className="flex flex-wrap gap-1 text-[10px]">
        {variation.scores.motion !== null && <span className={badge}>{m['ui.shapeshift.motion_score']({ value: Math.round(variation.scores.motion * 100) })}</span>}
        {variation.scores.verdict && FACE[variation.scores.verdict] && <span className={badge}>{FACE[variation.scores.verdict]!()}</span>}
      </p>}
      {(stopped?.error || joinError) && <p className="line-clamp-3 break-words text-[10px] text-red-700">{stopped?.error ?? joinError}</p>}
      {variation.resultAssetId && variation.resultUrl && <div className="flex flex-wrap items-center gap-1.5">
        <AddToTimeline projectId={projectId} assetId={variation.resultAssetId} />
        <a href={variation.resultUrl} download aria-label={m['ui.shapeshift.download']()} title={m['ui.shapeshift.download']()}
          className="grid size-8 place-items-center rounded-full border border-[var(--vh-border)] text-[var(--vh-text-2)] transition hover:text-[var(--vh-text-1)]"><Download className="size-3.5" /></a>
      </div>}
    </figcaption>
  </figure>;
}

/** Puts a result at the end of the project timeline; it already carries the source's sound and length. */
function AddToTimeline({ projectId, assetId }: { projectId: string; assetId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'added'>('idle'), [error, setError] = useState('');
  async function add() {
    setState('busy'); setError('');
    try {
      const { assets } = await apiJsonGet<{ assets: Array<RecentAsset & { type: string }> }>('/api/app/projects/' + encodeURIComponent(projectId) + '/assets');
      const asset = assets.find(item => item.id === assetId && item.type === 'video');
      if (!asset) throw Error(m['studio.tools.could_not_find_the_project_file_for_this_result_check_your_project_media']());
      await addProjectAssetToTimeline({ projectId, asset, mediaType: 'video' });
      setState('added');
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); setState('idle'); }
  }
  if (state === 'added') return <Link href={'/editor/' + projectId} className="inline-flex h-8 items-center px-1 text-[11px] font-semibold underline-offset-4 hover:underline">{m['ui.shapeshift.added']()}</Link>;
  return <>
    <Action type="button" disabled={state === 'busy'} onClick={() => void add()} className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--vh-text-1)] px-3 text-[11px] font-semibold text-[var(--vh-bg)] transition hover:opacity-90 disabled:opacity-50">
      {state === 'busy' ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}{m['ui.shapeshift.add_timeline']()}
    </Action>
    {error && <p role="alert" className="w-full text-[10px] text-red-700">{error}</p>}
  </>;
}
