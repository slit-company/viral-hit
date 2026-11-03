import { createFileRoute } from '@tanstack/react-router';
import { ShapeshiftPage } from '@/components/shapeshift/shapeshift-page';

export const Route = createFileRoute('/shapeshift/$projectId')({ component: Page });
function Page() { const { projectId } = Route.useParams(); return <ShapeshiftPage key={projectId} projectId={projectId} />; }
