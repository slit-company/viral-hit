import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanvasAssetCard, CanvasCard, CanvasGenerationCard, CanvasOutputCard } from './canvas-types';
import { branchCanvasCards, branchFrames, planCanvasRun, resolveCanvasReferenceAssetIds, type CanvasCards } from './canvas-run-plan';
import { captureGenerationSnapshot } from './generation-snapshot';

const base = { workflowTemplateId: null, status: 'idle' as const, error: null, aspectRatio: '16:9' as const, outputQuality: '1k' as const, duration: '5s' as const,
  mode: 'quality' as const, variant: 'standard' as const, quality: 'standard' as const, sourceGenerationId: null, url: null };
const asset = (id: string, assetId: string | null = 'asset-' + id): CanvasAssetCard =>
  ({ ...base, id, kind: 'asset', type: 'image', name: id, prompt: '', referenceCardIds: [], modelId: '', assetId, url: '/media/' + id });
const generation = (id: string, references: string[], extra: Partial<CanvasGenerationCard> = {}): CanvasGenerationCard =>
  ({ ...base, id, kind: 'generation', type: 'image', name: id, prompt: 'make ' + id, referenceCardIds: references, modelId: 'model-' + id, ...extra });
let clock = 0;
/** A finished take made from the card's current settings and inputs, pinned on the card. */
function run(cards: CanvasCards, cardId: string, assetId: string, recordInputs = true) {
  const card = cards[cardId] as CanvasGenerationCard;
  const snapshot = { ...captureGenerationSnapshot(card, card.aspectRatio, recordInputs ? resolveCanvasReferenceAssetIds(cards, card) : null), capturedAt: new Date(Date.UTC(2026, 10, 2, 0, 0, clock++)).toISOString() };
  const output: CanvasOutputCard = { ...card, id: 'out-' + assetId, kind: 'output', status: 'succeeded', assetId, url: '/media/' + assetId,
    referenceCardIds: [cardId], sourceConfigCardId: cardId, generationRunId: 'run-' + assetId, generationSnapshot: snapshot };
  cards[output.id] = output;
  cards[cardId] = { ...card, pinnedOutputId: output.id };
}
const summary = (cards: CanvasCards, target: string) => planCanvasRun(cards, target).steps.map((step) => [step.cardId, step.action, step.reason]);
function chain() {
  const cards: CanvasCards = { photo: asset('photo'), a: generation('a', ['photo']), b: generation('b', ['a'], { type: 'video' }) };
  run(cards, 'a', 'a1');
  run(cards, 'b', 'b1');
  return cards;
}

test('an unchanged chain reuses every pinned result, and an edited card runs alone', () => {
  const cards = chain();
  assert.deepEqual(summary(cards, 'b'), [['a', 'reuse', null], ['b', 'reuse', null]]);
  assert.deepEqual(planCanvasRun(cards, 'b').steps[0].assetId, 'a1');
  cards.b = { ...(cards.b as CanvasGenerationCard), prompt: 'make b slower' };
  const plan = planCanvasRun(cards, 'b');
  assert.deepEqual(plan.steps.map((step) => [step.cardId, step.action, step.reason]), [['a', 'reuse', null], ['b', 'run', 'settings']]);
  assert.deepEqual(plan.steps[1].inputs, [{ kind: 'asset', assetId: 'a1', mediaType: 'image' }], 'the unchanged upstream result feeds the run');
});

test('a changed upstream card runs, and everything that uses it runs after it', () => {
  const cards = chain();
  cards.a = { ...(cards.a as CanvasGenerationCard), modelId: 'model-other' };
  const plan = planCanvasRun(cards, 'b');
  assert.deepEqual(plan.steps.map((step) => [step.cardId, step.action, step.reason]), [['a', 'run', 'settings'], ['b', 'run', 'upstream']]);
  assert.deepEqual(plan.steps[1].inputs, [{ kind: 'step', cardId: 'a', mediaType: 'image' }]);
  cards.photo = asset('photo', 'asset-photo-2');
  cards.a = { ...(cards.a as CanvasGenerationCard), modelId: 'model-a' };
  assert.deepEqual(summary(cards, 'a'), [['a', 'run', 'inputs']], 'a replaced input image counts as a change');
});

test('a newer upstream result makes downstream results stale, with or without recorded inputs', () => {
  const cards = chain();
  run(cards, 'a', 'a2');
  assert.deepEqual(summary(cards, 'b'), [['a', 'reuse', null], ['b', 'run', 'inputs']]);
  const legacy: CanvasCards = { photo: asset('photo'), a: generation('a', ['photo']), b: generation('b', ['a'], { type: 'video' }) };
  run(legacy, 'a', 'a1', false);
  run(legacy, 'b', 'b1', false);
  assert.deepEqual(summary(legacy, 'b'), [['a', 'reuse', null], ['b', 'reuse', null]]);
  run(legacy, 'a', 'a2', false);
  assert.deepEqual(summary(legacy, 'b'), [['a', 'reuse', null], ['b', 'run', 'inputs']], 'without recorded inputs a newer input result counts');
  // Pinning an older take of a is also a change once inputs are recorded.
  run(cards, 'b', 'b2');
  cards.a = { ...(cards.a as CanvasGenerationCard), pinnedOutputId: 'out-a1' };
  assert.deepEqual(summary(cards, 'b'), [['a', 'reuse', null], ['b', 'run', 'inputs']]);
});

test('cards without results run; busy cards, missing inputs and loops block the plan', () => {
  const cards: CanvasCards = { photo: asset('photo'), a: generation('a', ['photo']), b: generation('b', ['a']) };
  assert.deepEqual(summary(cards, 'b'), [['a', 'run', 'no-result'], ['b', 'run', 'upstream']]);
  assert.deepEqual(planCanvasRun({ ...cards, a: { ...(cards.a as CanvasGenerationCard), status: 'processing' } }, 'b').blocked, { cardId: 'a', reason: 'busy' });
  assert.deepEqual(planCanvasRun({ ...cards, photo: asset('photo', null) }, 'b').blocked, { cardId: 'a', reason: 'missing-input' });
  assert.deepEqual(planCanvasRun({ ...cards, a: generation('a', ['b']) }, 'b').blocked, { cardId: 'b', reason: 'cycle' });
  assert.deepEqual(planCanvasRun(cards, 'photo').blocked, { cardId: 'photo', reason: 'not-generation' });
  const analysis = generation('notes', ['photo'], { generationMode: 'analysis' });
  assert.deepEqual(summary({ ...cards, notes: analysis, c: generation('c', ['notes', 'photo']) }, 'c'), [['c', 'run', 'no-result']], 'analysis text is not a media input');
});

test('a branch copies the card and its downstream cards, rewires them, keeps shared inputs and starts empty', () => {
  const cards = chain();
  cards.c = generation('c', ['b', 'photo']);
  cards.other = generation('other', ['photo']);
  const { copies, idMap } = branchCanvasCards(cards, 'a', (id) => id + '-branch');
  assert.deepEqual(Object.keys(idMap).sort(), ['a', 'b', 'c']);
  const byId = Object.fromEntries(copies.map((copy) => [copy.id, copy]));
  assert.deepEqual(byId['a-branch'].referenceCardIds, ['photo']);
  assert.deepEqual(byId['b-branch'].referenceCardIds, ['a-branch']);
  assert.deepEqual(byId['c-branch'].referenceCardIds, ['b-branch', 'photo']);
  assert.ok(copies.every((copy) => copy.pinnedOutputId === null && copy.status === 'idle' && copy.generationSnapshot === null));
  assert.equal(byId['b-branch'].type, 'video');
  const withCopies: CanvasCards = { ...cards, ...byId };
  assert.deepEqual(summary(withCopies, 'c-branch'), [['a-branch', 'run', 'no-result'], ['b-branch', 'run', 'upstream'], ['c-branch', 'run', 'upstream']]);
  const frames = branchFrames({ a: { x: 0, y: 0, w: 100, h: 50 }, b: { x: 200, y: 20, w: 100, h: 60 }, photo: { x: -200, y: 0, w: 10, h: 10 } }, idMap);
  assert.deepEqual(frames, { 'a-branch': { x: 0, y: 160, w: 100, h: 50 }, 'b-branch': { x: 200, y: 180, w: 100, h: 60 } });
  assert.throws(() => branchCanvasCards(cards, 'photo', (id) => id), /generation card/);
  const asCard: CanvasCard = byId['a-branch'];
  assert.equal(asCard.kind, 'generation');
});
