import { createFileRoute } from '@tanstack/react-router';
import { CommunityPage } from '@/components/community/community-page';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';
export const Route = createFileRoute('/community')({
  component: CommunityRoute,
});
function CommunityRoute() {
  return <CommunityPage locale={useLocale()} />;
}
