import { createFileRoute } from '@tanstack/react-router';
import { RemixPage } from '@/components/remix/remix-page';

export const Route = createFileRoute('/remix/$projectId')({ component: Page });
function Page() { const { projectId } = Route.useParams(); return <RemixPage key={projectId} projectId={projectId} />; }
