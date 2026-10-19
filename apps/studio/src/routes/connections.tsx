import { createFileRoute } from '@tanstack/react-router';
import { PublishingAccountsPage } from '@/components/publishing/publishing-accounts-page';

export const Route = createFileRoute('/connections')({
  validateSearch: (raw: Record<string, unknown>) => ({ youtube: typeof raw.youtube === 'string' && /^[a-z-]{1,32}$/.test(raw.youtube) ? raw.youtube : undefined }),
  component: ConnectionsRoute,
});
function ConnectionsRoute() {
  return <PublishingAccountsPage callbackIssue={Route.useSearch().youtube} />;
}
