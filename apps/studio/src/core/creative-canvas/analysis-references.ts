import type { CanvasCard, CanvasDraftCard } from './canvas-types';
import { resolveAnalysisInputs, type AnalysisInputs } from '../generation-providers/analysis-inputs';

export function canAttachAnalysisReference(draft: CanvasDraftCard, source: CanvasCard, cards: Record<string, CanvasCard | undefined>, inputs?: AnalysisInputs) {
  if (!source.url || source.id === draft.id || source.type === 'timeline') return false;
  if (draft.referenceCardIds.includes(source.id)) return true;
  const attached = draft.referenceCardIds.flatMap(id => cards[id] ? [cards[id]!] : []);
  if (source.assetId && attached.some(card => card.assetId === source.assetId)) return false;
  return attached.length < 20 && attached.filter(card => card.type === source.type).length < resolveAnalysisInputs(inputs)[source.type].max;
}
