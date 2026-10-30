import { m as uiMessages } from '@/paraglide/messages.js';
import type { CreativePackSummary } from '@/core/creative-packs/contract';

export function packContentsLabel(pack: Pick<CreativePackSummary, 'recipeCount' | 'skillCount' | 'characterCount'>) {
  return [
    uiMessages['ui.creative-packs.recipe_count']({ count: pack.recipeCount, plural: pack.recipeCount === 1 ? '' : 's' }),
    uiMessages['ui.creative-packs.skill_count']({ count: pack.skillCount, plural: pack.skillCount === 1 ? '' : 's' }),
    uiMessages['ui.creative-packs.character_count']({ count: pack.characterCount, plural: pack.characterCount === 1 ? '' : 's' }),
  ].join(' · ');
}
