import type { CanvasCard, CanvasDraftCard } from '@/core/creative-canvas/canvas-types';
import { buildCanvasReferenceMentions } from '@/core/creative-canvas/reference-mentions';

/** Prompt aliases and their thumbnails describe the same saved reference order. */
export function composerReferenceOptions(draft: CanvasDraftCard | null | undefined, cards: Record<string, CanvasCard>) {
  if (!draft) return [];
  return buildCanvasReferenceMentions({ referenceCardIds: draft.referenceCardIds, cards }).map(mention => ({
    id: mention.cardId,
    name: mention.name,
    type: mention.type,
    alias: mention.alias,
    thumbnailUrl: cards[mention.cardId]?.url ?? null,
  }));
}
