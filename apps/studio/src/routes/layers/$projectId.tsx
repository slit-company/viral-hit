import { createFileRoute } from '@tanstack/react-router';
import { LayersPage } from '@/components/image-layers/layers-page';

export const Route = createFileRoute('/layers/$projectId')({
  validateSearch: (search: Record<string, unknown>) => ({ stack: typeof search.stack === 'string' && search.stack ? search.stack : undefined }),
  component: LayersRoute,
});
function LayersRoute() {
  const { projectId } = Route.useParams(), { stack } = Route.useSearch();
  return <LayersPage key={projectId} projectId={projectId} stackId={stack ?? null} />;
}
