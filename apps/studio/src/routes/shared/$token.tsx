import { createFileRoute } from '@tanstack/react-router';
import { SharedReviewPage } from '@/components/collaboration/shared-review-page';

export const Route = createFileRoute('/shared/$token')({
  component: SharedRoute,
  // The token is in the address; keep it out of search engines and of links followed from the page.
  head: () => ({ meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }] }),
});
function SharedRoute() {
  const { token } = Route.useParams();
  return <SharedReviewPage token={token} />;
}
