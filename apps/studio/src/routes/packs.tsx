import { createFileRoute } from '@tanstack/react-router';
import { CreativePacksPage } from '@/components/creative-packs/creative-packs-page';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';
export const Route = createFileRoute('/packs')({ component: PacksRoute });
function PacksRoute() { return <CreativePacksPage locale={useLocale()} />; }
