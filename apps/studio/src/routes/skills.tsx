import { createFileRoute } from '@tanstack/react-router';
import { SkillsPage } from '@/components/skills/skills-page';
import { catalogHandoffSchema } from '@/core/community/contract';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';
export const Route = createFileRoute('/skills')({ validateSearch: search => catalogHandoffSchema.parse(search), component: SkillsRoute });
function SkillsRoute() { const shared = Route.useSearch(); return <SkillsPage key={shared.source + '/' + shared.sha256} shared={shared} locale={useLocale()} />; }
