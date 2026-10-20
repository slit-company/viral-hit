import { useEffect, useRef, type MutableRefObject } from 'react';
import type { WorkspaceModelOption } from '@/core/effects/workspace-models';
import { isCanvasDraftCard, type CanvasCard, type CanvasDraftCard } from '@/core/creative-canvas/canvas-types';
import { appendUniqueReferenceCardId, getDraftReferencePickerOptions, isDraftBusyStatus } from '@/core/creative-canvas/composer';
import { getSelectableModel } from '@/core/creative-canvas/generation-controller';
import { getProjectAssetCardSize, PROJECT_ASSET_REFERENCE_EVENT, type ProjectAssetReferenceDetail } from '@/core/creative-canvas/project-asset-transfer';

export type DraftReferenceDeps = {
  canvasCardsRef: MutableRefObject<Record<string, CanvasCard>>;
  imageModels: WorkspaceModelOption[];
  videoModels: WorkspaceModelOption[];
  updateDraftCard: (draftId: string, updater: (current: CanvasDraftCard) => CanvasDraftCard) => void;
  createConnectorBetweenCards: (sourceCardId: string, targetCardId: string) => void;
  setActiveComposerCardId: (cardId: string | null) => void;
  handleSelectShape: (shapeId: string | null) => void;
  focusShape: (shapeId: string) => void;
  focusShapes: (shapeIds: string[]) => void;
};

type InsertImageCard = (input: { type: 'image'; url: string; name: string; kind: 'asset'; assetId?: string | null; anchorCardIds?: string[]; placementSide?: 'left' | 'right'; activateOnInsert?: boolean; size?: { w: number; h: number } }) => string | null;

/**
 * Attaches an asset card to an idle draft when the draft's model accepts that media and has room;
 * otherwise selects the card so the person can connect it by hand. Returns whether it attached.
 */
export function attachAssetCardToDraft(deps: DraftReferenceDeps, { draftId, assetCardId, intent }: { draftId: string; assetCardId: string; intent: 'image' | 'video' }) {
  const draft = deps.canvasCardsRef.current[draftId];
  if (isCanvasDraftCard(draft) && !isDraftBusyStatus(draft.status)) {
    const attached = draft.referenceCardIds.includes(assetCardId);
    const model = getSelectableModel(draft.type === 'image' ? deps.imageModels : deps.videoModels, draft.modelId);
    if (attached || getDraftReferencePickerOptions({ draftCard: draft, cards: deps.canvasCardsRef.current, model }).some(option => option.intent === intent)) {
      if (!attached) {
        deps.updateDraftCard(draftId, current => isDraftBusyStatus(current.status) ? current
          : { ...current, referenceCardIds: appendUniqueReferenceCardId(current.referenceCardIds, assetCardId), status: 'idle', error: null });
        deps.createConnectorBetweenCards(assetCardId, draftId);
      }
      deps.setActiveComposerCardId(draftId);
      deps.handleSelectShape(draftId);
      deps.focusShapes([assetCardId, draftId]);
      return true;
    }
  }
  deps.handleSelectShape(assetCardId);
  deps.focusShape(assetCardId);
  return false;
}

/**
 * Lets panels outside the canvas, such as Characters in the composer, place a project image beside a draft
 * and attach it. An image already on the canvas is reused instead of being placed twice.
 */
export function useProjectAssetReferenceListener(input: DraftReferenceDeps & { projectId: string; insertAssetCard: InsertImageCard }) {
  const latest = useRef(input);
  useEffect(() => { latest.current = input; });
  useEffect(() => {
    const handle = (event: Event) => {
      const { asset, draftId } = (event as CustomEvent<ProjectAssetReferenceDetail>).detail ?? {};
      const deps = latest.current;
      if (!asset || !draftId || asset.projectId !== deps.projectId || asset.mediaType !== 'image') return;
      const existing = Object.values(deps.canvasCardsRef.current).find(card => card.kind === 'asset' && card.assetId === asset.id);
      const assetCardId = existing?.id ?? deps.insertAssetCard({ type: 'image', url: asset.publicUrl, name: asset.filename || asset.id, kind: 'asset', assetId: asset.id,
        anchorCardIds: [draftId], placementSide: 'left', activateOnInsert: false, size: getProjectAssetCardSize(asset) });
      if (assetCardId) attachAssetCardToDraft(deps, { draftId, assetCardId, intent: 'image' });
    };
    window.addEventListener(PROJECT_ASSET_REFERENCE_EVENT, handle);
    return () => window.removeEventListener(PROJECT_ASSET_REFERENCE_EVENT, handle);
  }, []);
}
