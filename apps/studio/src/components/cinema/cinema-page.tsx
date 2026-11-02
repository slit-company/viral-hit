import { ProductPageShell } from '@/components/app/product-page-shell';
import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { useQuery } from '@tanstack/react-query';
import { apiJsonGet } from '@/lib/api-client';
import { ShotForm } from './shot-form';
import { ShotPlan } from './shot-plan';
import { ShotRuns } from './shot-runs';
import { useCinemaDraft, useProduceShot, useShotPreview, useShotRuns } from './use-cinema';

/** Higgsfield-style shot direction: describe, see the plan, render takes, compare, send to the edit. */
export function CinemaPage({ projectId }: { projectId: string }) {
  const t = useTranslations('AppShell.cinema');
  const project = useQuery({ queryKey: ['cinema-project', projectId], queryFn: () => apiJsonGet<{ projects: Array<{ id: string; name: string }> }>('/api/app/projects').then(result => result.projects.find(item => item.id === projectId)), staleTime: 30_000 });
  const { draft, update, loaded } = useCinemaDraft(projectId);
  const preview = useShotPreview(projectId, draft), runs = useShotRuns(projectId), produce = useProduceShot(projectId);
  return <ProductPageShell projectId={projectId} workspaceName={project.data?.name} section="cinema">
    <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[440px_minmax(0,1fr)] lg:overflow-hidden">
      <aside aria-label={t('heading')} className="min-w-0 space-y-5 border-b border-[var(--vh-border)] bg-[var(--vh-surface)] p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="space-y-1.5"><h1 className="text-xl font-semibold tracking-[-0.02em]">{t('heading')}</h1><p className="text-xs leading-5 text-[var(--vh-text-2)]">{t('description')}</p></div>
        <ShotForm projectId={projectId} draft={draft} disabled={!loaded || produce.isPending} onChange={update} />
      </aside>
      <div className="min-w-0 space-y-6 p-5 lg:overflow-y-auto sm:p-6">
        <ShotPlan production={preview.data} variations={draft.variations ?? 2} loading={preview.isFetching} error={preview.error?.message ?? (produce.error?.message || null)}
          describeFirst={!draft.subject.trim()} busy={!loaded || produce.isPending} onProduce={() => produce.mutate(draft)} />
        <ShotRuns projectId={projectId} shots={runs.data ?? []} loading={runs.isPending} />
      </div>
    </div>
  </ProductPageShell>;
}
