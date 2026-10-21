import type { CreativePackSummary } from '@/core/creative-packs/contract';

export function packContentsLabel(pack: Pick<CreativePackSummary, 'recipeCount' | 'skillCount' | 'characterCount'>) {
  return [[pack.recipeCount, 'recipe'], [pack.skillCount, 'skill'], [pack.characterCount, 'character']]
    .map(([count, name]) => `${count} ${name}${count === 1 ? '' : 's'}`).join(' · ');
}
