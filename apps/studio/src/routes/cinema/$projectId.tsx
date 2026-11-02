import { createFileRoute } from '@tanstack/react-router';
import { CinemaPage } from '@/components/cinema/cinema-page';

export const Route = createFileRoute('/cinema/$projectId')({ component: Page });
function Page() { const { projectId } = Route.useParams(); return <CinemaPage key={projectId} projectId={projectId} />; }
