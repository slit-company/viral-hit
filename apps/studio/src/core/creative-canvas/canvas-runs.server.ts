import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CanvasOperation } from '../commands/canvas-commands';
import type { ViralHitCommandOrigin } from '../commands/contracts';
import { persistViralHitCommand } from '../commands/persist';
import { buildDraftModelParameters, hasModelParameter } from '../effects/model-parameters';
import { getGenerationModelDescriptor } from '../generation-providers/model-catalog';
import { assertRuntimeConfigured } from '../harness/capabilities';
import type { Job, Json, NodeSpec } from '../harness/durable';
import { pinRuntimePlan } from '../harness/runtime-plan';
import { openHarness } from '../harness/store';
import { loadProjectWithLatestSnapshot } from '../projects/projects';
import type { ProjectSnapshotShapeFrame } from '../projects/project-snapshot';
import { branchCanvasCards, branchFrames, planCanvasRun, type CanvasCards, type CanvasRunPlan, type CanvasRunStep } from './canvas-run-plan';
import { markCanvasTake, readCanvasTakes, recordCanvasTakes, type CanvasTake } from './canvas-takes.server';
import { getCanvasGenerationMode, isCanvasGenerationCard, type CanvasGenerationCard, type CanvasOutputCard } from './canvas-types';
import { captureGenerationSnapshot } from './generation-snapshot';

export const CANVAS_RUN_PREFIX = 'canvas:';
const NODE_PREFIX = 'card:';
const ROLE = { image: 'reference', video: 'source', audio: 'audio_track' } as const;
const cardId = z.string().trim().min(1).max(200);
export const canvasRunRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('plan'), cardId }).strict(),
  z.object({ action: z.literal('start'), cardId, requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('branch'), cardId, requestId: z.string().uuid() }).strict(),
]);
export type CanvasRunRequest = z.infer<typeof canvasRunRequest>;
type Canvas = { cards: CanvasCards; frames: Record<string, ProjectSnapshotShapeFrame>; revision: number };
type Shown = 'pending' | 'processing' | 'succeeded' | 'failed';

async function loadCanvas(projectId: string): Promise<Canvas> {
  const state = await loadProjectWithLatestSnapshot({ projectId });
  if (!state) throw new Error('Project not found.');
  return { cards: Object.fromEntries(state.snapshot.cards.map((card) => [card.id, card])), frames: state.snapshot.frames, revision: state.snapshotVersion };
}

/**
 * Writes operations built from the latest canvas. On a concurrent edit it rebuilds from the newer canvas
 * rather than replaying cards read before the edit, so a person's changes are never overwritten.
 */
async function changeCanvas<T>(projectId: string, origin: ViralHitCommandOrigin, build: (canvas: Canvas) => { operations: CanvasOperation[]; value: T }) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = await loadCanvas(projectId);
    const { operations, value } = build(canvas);
    if (!operations.length) return value;
    const result = await persistViralHitCommand({ projectId, origin, expectedRevision: canvas.revision, command: { type: 'canvas.apply', operations } });
    if (result.ok) return value;
    if (result.code !== 'REVISION_CONFLICT') throw new Error(result.message);
  }
  throw new Error('The canvas kept changing. Try again.');
}

const BLOCKED: Record<NonNullable<CanvasRunPlan['blocked']>['reason'], string> = {
  busy: 'is still generating', 'missing-input': 'has an input without a finished result', cycle: 'is part of a reference loop', 'not-generation': 'is not a generation card',
};
function describePlan(plan: CanvasRunPlan, cards: CanvasCards) {
  const name = (id: string) => cards[id]?.name ?? id;
  return {
    blocked: plan.blocked ? { ...plan.blocked, name: name(plan.blocked.cardId), message: `${name(plan.blocked.cardId)} ${BLOCKED[plan.blocked.reason]}.` } : null,
    steps: plan.steps.map((step) => {
      const card = cards[step.cardId] as CanvasGenerationCard;
      return { cardId: step.cardId, name: card.name, modelId: card.modelId, mode: getCanvasGenerationMode(card), action: step.action, reason: step.reason };
    }),
  };
}

export async function planCanvasRunForProject(projectId: string, target: string) {
  const canvas = await loadCanvas(projectId);
  return describePlan(planCanvasRun(canvas.cards, target), canvas.cards);
}

/** One durable generation step per card; inputs made in this run arrive through bindings. Same inputs reuse an earlier result. */
function stepNode(card: CanvasGenerationCard, step: CanvasRunStep): NodeSpec {
  const mode = getCanvasGenerationMode(card), descriptor = getGenerationModelDescriptor(card.modelId);
  if (!descriptor || descriptor.kind !== mode) throw new Error(`${card.name} uses ${card.modelId}, which is not an installed ${mode} model.`);
  const references = step.inputs.map((input, index) => ({ assetId: input.kind === 'asset' ? input.assetId : 'pending-' + index, kind: input.mediaType, role: ROLE[input.mediaType] }));
  const bindings = step.inputs.flatMap((input, index) => (input.kind === 'step' ? [{ node: NODE_PREFIX + input.cardId, pointer: '/assetId', target: `/references/${index}/assetId` }] : []));
  const parameters = { ...buildDraftModelParameters({ ...card, modelId: descriptor.id }, descriptor.parameterSchema),
    ...(mode === 'analysis' && hasModelParameter(descriptor.parameterSchema, 'analysis_depth') ? { analysis_depth: card.analysisDepth ?? 'standard' } : {}) };
  return { id: NODE_PREFIX + card.id, operation: 'generation.model', version: '1', cache: true,
    input: { schemaVersion: 1, mode, modelId: descriptor.id, prompt: card.prompt.trim(), references, parameters, outputIndex: 0 } as unknown as Json,
    ...(bindings.length ? { dependsOn: [...new Set(bindings.map((binding) => binding.node))], bindings } : {}) };
}

/**
 * Runs the stale cards a card depends on, then the card, as one durable run. Takes appear on the canvas as
 * the run progresses (see syncCanvasRuns). Replaying a requestId returns the original run.
 */
export async function startCanvasRun(projectId: string, request: { cardId: string; requestId: string }, origin: ViralHitCommandOrigin) {
  const requestKey = CANVAS_RUN_PREFIX + request.requestId;
  const existing = (() => { const h = openHarness(); try { return h.runs(projectId).find((run) => run.request_key === requestKey); } finally { h.close(); } })();
  if (existing) return { runId: String(existing.id), plan: null, ...(await syncCanvasRuns(projectId, origin)) };
  const canvas = await loadCanvas(projectId), plan = planCanvasRun(canvas.cards, request.cardId), described = describePlan(plan, canvas.cards);
  if (described.blocked) throw new Error(described.blocked.message);
  const runs = plan.steps.filter((step) => step.action === 'run');
  if (!runs.length) return { runId: null, plan: described, ...(await syncCanvasRuns(projectId, origin)) };
  const nodes = runs.map((step) => stepNode(canvas.cards[step.cardId] as CanvasGenerationCard, step));
  assertRuntimeConfigured(nodes);
  const pinned = await pinRuntimePlan({ projectId, nodes });
  const h = openHarness();
  let runId: string;
  try {
    runId = h.enqueue(pinned, requestKey);
    recordCanvasTakes(h.db, h.jobs(runId).map((job) => {
      const step = runs.find((item) => NODE_PREFIX + item.cardId === job.node_id)!, card = canvas.cards[step.cardId] as CanvasGenerationCard;
      const known = step.inputs.every((input) => input.kind === 'asset') ? step.inputs.map((input) => (input.kind === 'asset' ? input.assetId : '')) : null;
      return { jobId: job.id, projectId, runId, cardId: card.id, outputCardId: 'output:canvas-' + job.id, snapshot: captureGenerationSnapshot(card, card.aspectRatio, known) };
    }));
  } finally { h.close(); }
  return { runId, plan: described, ...(await syncCanvasRuns(projectId, origin)) };
}

function desired(job: Job | undefined, held: boolean) {
  if (!job) return { state: 'failed' as Shown, error: 'This step is missing from its run.' };
  if (job.state === 'succeeded') {
    const output = JSON.parse(job.output_json ?? '{}') as { assetId?: string; publicUrl?: string; text?: string };
    const input = JSON.parse(job.execution_input_json ?? job.input_json) as { references?: Array<{ assetId: string }> };
    return { state: 'succeeded' as Shown, output, used: input.references?.map((reference) => reference.assetId) };
  }
  if (['failed', 'uncertain', 'blocked', 'canceled'].includes(job.state)) return { state: 'failed' as Shown, error: job.error ?? (job.state === 'canceled' ? 'Canceled.' : 'The generation did not finish.') };
  return { state: (!held && ['submitting', 'running'].includes(job.state) ? 'processing' : 'pending') as Shown };
}

const SNAPSHOT_ONLY = new Set(['capturedAt', 'referenceAssetIds', 'resultText']);
function takeOperations(canvas: Canvas, changes: Array<{ take: CanvasTake; want: ReturnType<typeof desired> }>) {
  const operations: CanvasOperation[] = [], marks: Array<{ jobId: string; state: Shown; outputCardId?: string }> = [], sources = new Map<string, CanvasGenerationCard>();
  for (const { take, want } of changes) {
    const source = sources.get(take.cardId) ?? canvas.cards[take.cardId];
    if (!isCanvasGenerationCard(source)) { marks.push({ jobId: take.jobId, state: want.state }); continue; }
    const terminal = want.state === 'succeeded' || want.state === 'failed';
    let output = canvas.cards[take.outputCardId];
    // A cached result that the canvas already shows as a take is pinned again instead of duplicated.
    const shown = !output && want.state === 'succeeded' && want.output?.assetId
      ? Object.values(canvas.cards).find((card) => card?.kind === 'output' && card.sourceConfigCardId === source.id && card.assetId === want.output!.assetId) : undefined;
    let pinned: string | null | undefined = undefined;
    if (shown) pinned = shown.id;
    else if (output || take.shownState === null) {
      const settings = Object.fromEntries(Object.entries(take.snapshot).filter(([key]) => !SNAPSHOT_ONLY.has(key)));
      const base: CanvasOutputCard = output?.kind === 'output' ? output : { ...source, ...settings, id: take.outputCardId, kind: 'output',
        name: `${getGenerationModelDescriptor(take.snapshot.modelId)?.name ?? take.snapshot.modelId} result`, assetId: null, url: null, resultText: null,
        referenceCardIds: [source.id], pinnedOutputId: null, sourceGenerationId: null, sourceConfigCardId: source.id, generationRunId: take.runId, generationSnapshot: take.snapshot, status: 'pending', error: null } as CanvasOutputCard;
      const next: CanvasOutputCard = { ...base, status: want.state, error: want.state === 'failed' ? want.error ?? null : null,
        ...(want.state === 'succeeded' ? { assetId: want.output?.assetId ?? null, url: want.output?.publicUrl ?? null, resultText: want.output?.text ?? null,
          generationSnapshot: { ...base.generationSnapshot, ...(want.used ? { referenceAssetIds: want.used } : {}) } } : {}) };
      operations.push({ type: 'upsert_card', card: next });
      if (!output) operations.push({ type: 'place_card', cardId: next.id, sourceCardIds: [source.id], side: 'right' });
      output = next;
      if (want.state === 'succeeded') pinned = next.id;
    }
    const updated: CanvasGenerationCard = { ...source, status: terminal ? 'idle' : want.state, error: null, ...(pinned ? { pinnedOutputId: pinned } : {}) };
    sources.set(source.id, updated);
    marks.push({ jobId: take.jobId, state: want.state, ...(shown ? { outputCardId: shown.id } : {}) });
  }
  for (const card of sources.values()) operations.push({ type: 'upsert_card', card });
  return { operations, value: marks };
}

/** Brings canvas takes up to date with their durable runs; idempotent, and cheap when nothing changed. */
export async function syncCanvasRuns(projectId: string, origin: ViralHitCommandOrigin) {
  const h = openHarness();
  const changes: Array<{ take: CanvasTake; want: ReturnType<typeof desired> }> = [];
  const runs: Array<{ runId: string; held: boolean; createdAt: number; steps: Array<{ cardId: string; state: Shown }> }> = [];
  try {
    const takes = readCanvasTakes(h.db, projectId);
    for (const run of h.runs(projectId).filter((row) => String(row.request_key).startsWith(CANVAS_RUN_PREFIX)).slice(0, 20)) {
      const jobs = h.jobs(String(run.id)), held = Boolean(run.held), steps: Array<{ cardId: string; state: Shown }> = [];
      for (const take of takes.filter((item) => item.runId === run.id)) {
        const want = desired(jobs.find((job) => job.id === take.jobId), held);
        steps.push({ cardId: take.cardId, state: want.state });
        if (take.shownState !== want.state) changes.push({ take, want });
      }
      runs.push({ runId: String(run.id), held, createdAt: Number(run.created_at), steps });
    }
  } finally { h.close(); }
  if (changes.length) {
    const marks = await changeCanvas(projectId, origin, (canvas) => takeOperations(canvas, changes));
    const store = openHarness();
    try { for (const mark of marks) markCanvasTake(store.db, mark.jobId, mark.state, mark.outputCardId); } finally { store.close(); }
  }
  return { active: runs.some((run) => run.steps.some((step) => step.state === 'pending' || step.state === 'processing')), runs };
}

/** Copies a card and everything downstream below the originals; replaying a requestId changes nothing. */
export async function branchCanvas(projectId: string, request: { cardId: string; requestId: string }, origin: ViralHitCommandOrigin) {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const prefix = 'shape:branch-' + hash(request.requestId).slice(0, 10) + '-';
  return changeCanvas(projectId, origin, (canvas) => {
    const { copies, idMap } = branchCanvasCards(canvas.cards, request.cardId, (id) => prefix + hash(id).slice(0, 8));
    const value = { cardId: idMap[request.cardId], cardIds: copies.map((copy) => copy.id) };
    if (copies.every((copy) => canvas.cards[copy.id])) return { operations: [], value };
    const frames = branchFrames(canvas.frames, idMap);
    return { operations: copies.map((card): CanvasOperation => ({ type: 'upsert_card', card, ...(frames[card.id] ? { frame: frames[card.id] } : {}) })), value };
  });
}

export async function changeCanvasRuns(projectId: string, raw: unknown, origin: ViralHitCommandOrigin) {
  const request = canvasRunRequest.parse(raw);
  if (request.action === 'plan') return { plan: await planCanvasRunForProject(projectId, request.cardId) };
  if (request.action === 'start') return startCanvasRun(projectId, request, origin);
  if (request.action === 'branch') return branchCanvas(projectId, request, origin);
  return syncCanvasRuns(projectId, origin);
}
