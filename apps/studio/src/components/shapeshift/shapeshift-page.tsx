import { useQuery } from '@tanstack/react-query';
import { ProductPageShell } from '@/components/app/product-page-shell';
import { apiJsonGet } from '@/lib/api-client';
import { ShapeshiftForm } from './shapeshift-form';
import { ShapeshiftRuns } from './shapeshift-runs';

/** Rebuild who or what is in a video while its motion, timing, camera and sound stay. */
export function ShapeshiftPage({ projectId }: { projectId: string }) {
  const project = useQuery({ queryKey: ['shapeshift-project', projectId], staleTime: 30_000,
    queryFn: () => apiJsonGet<{ projects: Array<{ id: string; name: string }> }>('/api/app/projects').then(result => result.projects.find(item => item.id === projectId) ?? null) });
  return <ProductPageShell projectId={projectId} workspaceName={project.data?.name} section="shapeshift">
    <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[440px_minmax(0,1fr)] lg:overflow-hidden">
      <ShapeshiftForm projectId={projectId} />
      <ShapeshiftRuns projectId={projectId} />
    </div>
  </ProductPageShell>;
}
