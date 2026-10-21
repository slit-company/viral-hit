import { createFileRoute } from '@tanstack/react-router';
import { CreativePacksPage } from '@/components/creative-packs/creative-packs-page';
import { catalogHandoffSchema } from '@/core/community/contract';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';
export const Route = createFileRoute('/packs')({ validateSearch: search => catalogHandoffSchema.parse(search), component: PacksRoute });
function PacksRoute() { const shared = Route.useSearch(); return <CreativePacksPage key={shared.source + '/' + shared.sha256} shared={shared} locale={useLocale()} />; }
