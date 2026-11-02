import type { CanvasCard, CanvasGenerationCard, CanvasGenerationSnapshot, CanvasOutputCard } from './canvas-types';
import { getCanvasGenerationMode, isCanvasGenerationCard } from './canvas-types';
import { listGenerationOutputsForDraft, resolvePinnedGenerationOutputId } from './generation-history';

export type CanvasCards = Record<string, CanvasCard | undefined>;
/** Why a step runs: no usable result yet, its settings changed, its inputs changed, or an input it uses runs first. */
export type CanvasRunReason = 'no-result' | 'settings' | 'inputs' | 'upstream';
export type CanvasRunInput =
  | { kind: 'asset'; assetId: string; mediaType: 'image' | 'video' | 'audio' }
  | { kind: 'step'; cardId: string; mediaType: 'image' | 'video' };
export type CanvasRunStep = {
  cardId: string; action: 'run' | 'reuse'; reason: CanvasRunReason | null;
  /** The pinned result a reused step contributes downstream. */
  assetId: string | null; inputs: CanvasRunInput[];
};
export type CanvasRunBlock = { cardId: string; reason: 'busy' | 'missing-input' | 'cycle' | 'not-generation' };
export type CanvasRunPlan = { steps: CanvasRunStep[]; blocked: CanvasRunBlock | null };

const BUSY = new Set(['pending', 'processing']);
const SETTINGS = ['generationMode', 'analysisDepth', 'modelOptions', 'workflowTemplateId', 'modelId', 'outputQuality', 'duration', 'language', 'mode', 'variant', 'quality', 'characterOrientation', 'backgroundSource'] as const;
const stable = (value: unknown): string => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}'
  : JSON.stringify(value ?? null);
const assetIdOf = (card: CanvasCard) => card.assetId?.trim() || null;

/** The output a generation card shows: its pinned take when that take finished, otherwise none. */
export function pinnedCanvasResult(cards: CanvasCards, card: CanvasGenerationCard): CanvasOutputCard | null {
  const outputs = listGenerationOutputsForDraft(cards, card.id);
  const id = resolvePinnedGenerationOutputId({ outputs, pinnedOutputId: card.pinnedOutputId });
  const output = id ? cards[id] : undefined;
  if (!output || output.kind !== 'output' || output.status !== 'succeeded') return null;
  return getCanvasGenerationMode(card) === 'analysis' ? (output.resultText ? output : null) : (assetIdOf(output) ? output : null);
}

/** Settings that decide what a card generates. Aspect ratio is skipped when a reference picks it (character orientation models). */
export function canvasSettingsChanged(card: CanvasGenerationCard, snapshot: CanvasGenerationSnapshot) {
  if (card.prompt.trim() !== snapshot.prompt.trim()) return true;
  if (stable(card.referenceCardIds) !== stable(snapshot.referenceCardIds)) return true;
  if (!card.characterOrientation && card.aspectRatio !== snapshot.aspectRatio) return true;
  return SETTINGS.some((key) => stable(card[key]) !== stable(snapshot[key]));
}

const isBusy = (cards: CanvasCards, card: CanvasGenerationCard) => BUSY.has(card.status)
  || Object.values(cards).some((other) => other?.kind === 'output' && other.sourceConfigCardId === card.id && BUSY.has(other.status));

/**
 * Plans running one generation card on the canvas: the card and every generation card it depends on,
 * in order. A card reuses its pinned result when its settings and inputs are unchanged since that result
 * was made; otherwise it runs, and so does everything that uses it. Analysis results are text and never
 * feed media inputs.
 */
export function planCanvasRun(cards: CanvasCards, targetCardId: string): CanvasRunPlan {
  const steps = new Map<string, CanvasRunStep>(), order: CanvasRunStep[] = [], visiting = new Set<string>();
  let blocked: CanvasRunBlock | null = null;
  const visit = (cardId: string): CanvasRunStep | null => {
    if (blocked) return null;
    const done = steps.get(cardId);
    if (done) return done;
    const card = cards[cardId];
    if (!isCanvasGenerationCard(card)) { blocked = { cardId, reason: 'not-generation' }; return null; }
    if (visiting.has(cardId)) { blocked = { cardId, reason: 'cycle' }; return null; }
    if (isBusy(cards, card)) { blocked = { cardId, reason: 'busy' }; return null; }
    visiting.add(cardId);
    const inputs: CanvasRunInput[] = [];
    let upstream = false;
    for (const referenceId of card.referenceCardIds) {
      const reference = cards[referenceId];
      if (!reference) { blocked = { cardId, reason: 'missing-input' }; return null; }
      if (isCanvasGenerationCard(reference)) {
        if (getCanvasGenerationMode(reference) === 'analysis') continue;
        const step = visit(referenceId);
        if (!step) return null;
        if (step.action === 'run') { upstream = true; inputs.push({ kind: 'step', cardId: referenceId, mediaType: reference.type }); }
        else inputs.push({ kind: 'asset', assetId: step.assetId!, mediaType: reference.type });
        continue;
      }
      if (reference.type !== 'image' && reference.type !== 'video' && reference.type !== 'audio') continue;
      const assetId = assetIdOf(reference);
      if (!assetId || (reference.kind === 'output' && reference.status !== 'succeeded')) { blocked = { cardId, reason: 'missing-input' }; return null; }
      inputs.push({ kind: 'asset', assetId, mediaType: reference.type });
    }
    visiting.delete(cardId);
    const pinned = pinnedCanvasResult(cards, card);
    const snapshot = pinned?.generationSnapshot;
    const used = snapshot?.referenceAssetIds;
    const current = inputs.flatMap((input) => (input.kind === 'asset' ? [input.assetId] : []));
    // Older results did not record their inputs; then an input result newer than this one counts as a change.
    const inputsChanged = used ? stable(used) !== stable(current)
      : card.referenceCardIds.some((id) => { const reference = cards[id]; const result = isCanvasGenerationCard(reference) ? pinnedCanvasResult(cards, reference) : null; return Boolean(result && snapshot && result.generationSnapshot.capturedAt > snapshot.capturedAt); });
    const reason: CanvasRunReason | null = upstream ? 'upstream' : !pinned ? 'no-result' : canvasSettingsChanged(card, snapshot!) ? 'settings' : inputsChanged ? 'inputs' : null;
    const step: CanvasRunStep = { cardId, action: reason ? 'run' : 'reuse', reason, assetId: reason ? null : assetIdOf(pinned!), inputs };
    steps.set(cardId, step);
    order.push(step);
    return step;
  };
  visit(targetCardId);
  return blocked ? { steps: [], blocked } : { steps: order, blocked: null };
}

/** Asset IDs a generation card would use right now, or null while any input has no finished asset. */
export function resolveCanvasReferenceAssetIds(cards: CanvasCards, card: CanvasGenerationCard): string[] | null {
  const ids: string[] = [];
  for (const referenceId of card.referenceCardIds) {
    const reference = cards[referenceId];
    if (!reference) return null;
    if (isCanvasGenerationCard(reference)) {
      if (getCanvasGenerationMode(reference) === 'analysis') continue;
      const result = pinnedCanvasResult(cards, reference);
      if (!result) return null;
      ids.push(assetIdOf(result)!);
    } else if (reference.type === 'image' || reference.type === 'video' || reference.type === 'audio') {
      const assetId = assetIdOf(reference);
      if (!assetId) return null;
      ids.push(assetId);
    }
  }
  return ids;
}

/**
 * Copies a generation card and every generation card downstream of it, rewiring references inside the
 * copy so the branch can change without touching the original. Shared inputs stay shared; copies start
 * without results.
 */
export function branchCanvasCards(cards: CanvasCards, cardId: string, makeId: (sourceId: string) => string) {
  const root = cards[cardId];
  if (!isCanvasGenerationCard(root)) throw new Error('Choose a generation card to branch.');
  const members = new Set([cardId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const card of Object.values(cards)) {
      if (isCanvasGenerationCard(card) && !members.has(card.id) && card.referenceCardIds.some((id) => members.has(id))) { members.add(card.id); grew = true; }
    }
  }
  const idMap = Object.fromEntries([...members].map((id) => [id, makeId(id)]));
  const copies = [...members].map((id): CanvasGenerationCard => {
    const card = cards[id] as CanvasGenerationCard;
    return { ...card, id: idMap[id], referenceCardIds: card.referenceCardIds.map((reference) => idMap[reference] ?? reference),
      status: 'idle', error: null, url: null, assetId: null, resultText: null, pinnedOutputId: null,
      sourceGenerationId: null, generationRunId: null, generationSnapshot: null };
  });
  return { copies, idMap };
}

/** Places branch copies below the originals, keeping their layout. */
export function branchFrames<F extends { x: number; y: number; w: number; h: number }>(frames: Record<string, F | undefined>, idMap: Record<string, string>) {
  const placed = Object.keys(idMap).flatMap((id) => (frames[id] ? [frames[id]!] : []));
  if (!placed.length) return {};
  const top = Math.min(...placed.map((frame) => frame.y)), bottom = Math.max(...placed.map((frame) => frame.y + frame.h));
  const shift = bottom - top + 80;
  return Object.fromEntries(Object.entries(idMap).flatMap(([id, copy]) => (frames[id] ? [[copy, { ...frames[id]!, y: frames[id]!.y + shift }]] : [])));
}
