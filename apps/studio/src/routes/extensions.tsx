import { createFileRoute } from '@tanstack/react-router';
import { ExtensionsPage } from '@/components/extensions/extensions-page';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';
export const Route = createFileRoute('/extensions')({ component: ExtensionsRoute });
function ExtensionsRoute() { return <ExtensionsPage locale={useLocale()} />; }
