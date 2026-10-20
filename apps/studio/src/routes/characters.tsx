import { createFileRoute } from '@tanstack/react-router';
import { CharactersPage } from '@/components/characters/characters-page';
import { useLocale } from '@/core/workspace-lib/shims/next-intl';

export const Route = createFileRoute('/characters')({ component: CharactersRoute });
function CharactersRoute() {
  return <CharactersPage locale={useLocale()} />;
}

