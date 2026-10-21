import { createFileRoute } from '@tanstack/react-router';
import { SkillsPage } from '@/components/skills/skills-page';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';
export const Route = createFileRoute('/skills')({ component: SkillsRoute });
function SkillsRoute() { return <SkillsPage locale={useLocale()} />; }
