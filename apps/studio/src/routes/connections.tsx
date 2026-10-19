import { createFileRoute } from '@tanstack/react-router';
import { PublishingAccountsPage } from '@/components/publishing/publishing-accounts-page';

export const Route = createFileRoute('/connections')({
  validateSearch: (raw: Record<string, unknown>) => ({ instagram: typeof raw.instagram === 'string' && /^[a-z-]{1,32}$/.test(raw.instagram) ? raw.instagram : undefined, instagramState: typeof raw.instagramState === 'string' && /^[a-zA-Z0-9_-]{43,128}$/.test(raw.instagramState) ? raw.instagramState : undefined, youtube: typeof raw.youtube === 'string' && /^[a-z-]{1,32}$/.test(raw.youtube) ? raw.youtube : undefined }),
  component: ConnectionsRoute,
});
function ConnectionsRoute() {
  const search = Route.useSearch(), navigate = Route.useNavigate();
  return <PublishingAccountsPage callbackIssue={search.youtube} instagramIssue={search.instagram} instagramState={search.instagramState} onInstagramSelectionDone={() => { void navigate({ search: { ...search, instagram: undefined, instagramState: undefined }, replace: true }); }} />;
}
