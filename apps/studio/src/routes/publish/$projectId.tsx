import { createFileRoute } from '@tanstack/react-router';
import { PublicationsPage } from '@/components/publishing/publications-page';

export const Route = createFileRoute('/publish/$projectId')({ component: Page });
function Page() { const { projectId } = Route.useParams(); return <PublicationsPage key={projectId} projectId={projectId} />; }
