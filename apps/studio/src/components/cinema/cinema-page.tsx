import { ProductPageShell } from '@/components/app/product-page-shell';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { useQuery } from '@tanstack/react-query';
import { apiJsonGet } from '@/lib/api-client';
import { groupShotSequences } from '@/core/shot-harness/sequence';
import { ShotForm } from './shot-form';
import { ShotPlan } from './shot-plan';
import { ShotRuns, type ShotRunActions } from './shot-runs';
import { SequenceBanner, SequenceStrip } from './sequence-strip';
import { DEFAULT_DRAFT, useCinemaDraft, useCinemaSequence, useContinueFromTake, useProduceShot, useShotPreview, useShotRuns, type CinemaDraft } from './use-cinema';

const CLEARED: Partial<CinemaDraft> = { framing: undefined, angle: undefined, lens: undefined, light: undefined, look: undefined, startAssetId: undefined, endAssetId: undefined };

/** Higgsfield-style shot direction: describe, see the plan, render takes, compare, continue the scene, send to the edit. */
export function CinemaPage({ projectId }: { projectId: string }) {
  const t = useTranslations('AppShell.cinema');
  const project = useQuery({ queryKey: ['cinema-project', projectId], queryFn: () => apiJsonGet<{ projects: Array<{ id: string; name: string }> }>('/api/app/projects').then(result => result.projects.find(item => item.id === projectId)), staleTime: 30_000 });
  const { draft, update, loaded } = useCinemaDraft(projectId);
  const { sequence, setSequence } = useCinemaSequence(projectId);
  const preview = useShotPreview(projectId, draft), runs = useShotRuns(projectId), produce = useProduceShot(projectId), continueFrom = useContinueFromTake(projectId);
  const sequences = groupShotSequences(runs.data ?? []);
  const current = sequence ? sequences.find(item => item.sequenceId === sequence.id) : undefined;
  const lastPosition = current ? Math.max(...current.positions.map(slot => slot.position)) : 0;
  const mode = sequence?.shotId ? 'edit' : sequence?.continuesFrom ? 'continue' : 'add';
  const position = mode === 'edit' ? (sequence?.position ?? 1) : lastPosition + 1;
  const render = (spec: CinemaDraft, target = sequence) => produce.mutate({ spec, sequence: target }, {
    onSuccess: result => { if (target) setSequence({ id: result.placement.sequenceId }); },
  });
  const actions: ShotRunActions = {
    busy: !loaded || produce.isPending,
    continuing: continueFrom.isPending ? (continueFrom.variables ?? null) : null,
    onReuseKeyframe: assetId => update({ startAssetId: assetId, startFrame: 'generate' }),
    // Another attempt animates the same keyframe when there is one, so only the takes are new.
    onRenderAgain: shot => shot.spec && render({ ...DEFAULT_DRAFT, ...CLEARED, ...shot.spec, ...(shot.still?.assetId && !shot.spec.startAssetId ? { startAssetId: shot.still.assetId } : {}) } as CinemaDraft,
      { id: shot.sequenceId, shotId: shot.shotId, ...(shot.continuesFrom ? { continuesFrom: shot.continuesFrom } : {}) }),
    onEdit: shot => {
      if (!shot.spec) return;
      update({ ...DEFAULT_DRAFT, ...CLEARED, ...shot.spec } as Partial<CinemaDraft>);
      setSequence({ id: shot.sequenceId, shotId: shot.shotId, position: shot.position, ...(shot.continuesFrom ? { continuesFrom: shot.continuesFrom } : {}) });
    },
    onContinue: (shot, take) => take.assetId && continueFrom.mutate(take.assetId, { onSuccess: frame => {
      update({ ...(shot.spec ?? {}), startAssetId: frame.assetId, startFrame: 'generate', endAssetId: undefined, action: '' } as Partial<CinemaDraft>);
      setSequence({ id: shot.sequenceId, continuesFrom: take.assetId!, frameUrl: frame.url });
    } }),
  };
  return <ProductPageShell projectId={projectId} workspaceName={project.data?.name} section="cinema">
    <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[440px_minmax(0,1fr)] lg:overflow-hidden">
      <aside aria-label={t('heading')} className="min-w-0 space-y-5 border-b border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="space-y-1.5"><h1 className="text-xl font-semibold tracking-[-0.02em]">{t('heading')}</h1><p className="text-xs leading-5 text-[var(--vh-text-2)]">{t('description')}</p></div>
        {sequence && <SequenceBanner position={position} mode={mode} frameUrl={sequence.frameUrl} onReset={() => setSequence(null)} />}
        <ShotForm projectId={projectId} draft={draft} disabled={!loaded || produce.isPending} onChange={update} />
      </aside>
      <div className="min-w-0 space-y-6 p-5 lg:overflow-y-auto sm:p-6">
        <ShotPlan production={preview.data} variations={draft.variations ?? 2} loading={preview.isFetching} error={preview.error?.message ?? (produce.error?.message || continueFrom.error?.message || null)}
          describeFirst={!draft.subject.trim()} busy={!loaded || produce.isPending} onProduce={() => render(draft)} />
        <SequenceStrip projectId={projectId} sequences={sequences} />
        <ShotRuns projectId={projectId} shots={runs.data ?? []} loading={runs.isPending} actions={actions} />
      </div>
    </div>
  </ProductPageShell>;
}
