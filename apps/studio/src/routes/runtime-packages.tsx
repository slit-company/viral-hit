import { catalogHandoffSchema } from '@/core/community/contract';
import { createFileRoute } from '@tanstack/react-router';
import { RuntimePackagesPage } from '@/components/runtime-packages/runtime-packages-page';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';
export const Route = createFileRoute('/runtime-packages')({ validateSearch: search => catalogHandoffSchema.parse(search), component: RuntimePackagesRoute });
function RuntimePackagesRoute() { const shared = Route.useSearch(); return <RuntimePackagesPage key={(shared.source ?? '') + '/' + (shared.sha256 ?? '')} shared={shared} locale={useLocale()} />; }
