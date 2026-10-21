import { createFileRoute } from '@tanstack/react-router';
import { RuntimePackagesPage } from '@/components/runtime-packages/runtime-packages-page';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';
export const Route = createFileRoute('/runtime-packages')({ component: RuntimePackagesRoute });
function RuntimePackagesRoute() { return <RuntimePackagesPage locale={useLocale()} />; }
