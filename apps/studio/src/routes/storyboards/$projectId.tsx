import { createFileRoute } from '@tanstack/react-router';
import { StoryboardsPage } from '@/components/storyboards/storyboards-page';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';
export const Route = createFileRoute('/storyboards/$projectId')({ component: StoryboardsRoute });
function StoryboardsRoute() { return <StoryboardsPage key={Route.useParams().projectId} projectId={Route.useParams().projectId} locale={useLocale()} />; }
