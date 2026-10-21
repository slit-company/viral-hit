import { createFileRoute } from '@tanstack/react-router';
import { RecipePacksPage } from '@/components/community/recipe-packs-page';
import { catalogHandoffSchema } from '@/core/community/contract';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';
export const Route = createFileRoute('/recipe-packs')({
  validateSearch: (search) => catalogHandoffSchema.parse(search),
  component: RecipePacksRoute,
});
function RecipePacksRoute() {
  const shared = Route.useSearch();
  return (
    <RecipePacksPage
      key={shared.source + '/' + shared.sha256}
      shared={shared}
      locale={useLocale()}
    />
  );
}
