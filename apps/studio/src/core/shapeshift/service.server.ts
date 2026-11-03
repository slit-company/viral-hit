import type { Json, NodeSpec } from '../harness/durable';
import { assertRuntimeConfigured } from '../harness/capabilities';
import { pinRuntimePlan } from '../harness/runtime-plan';
import { useCharacterInProject } from '../characters/library.server';
import { estimateGenerationStep } from '../costs/generation-cost.server';
import { sumCosts } from '../costs/pricing';
import { getActiveProject } from '../projects/projects';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { listShotModels } from '../shot-harness/catalog.server';
import type { ShotModel } from '../shot-harness/spec';
import { extractProjectVideoSegment } from '../character-swap/segment.server';
import { composeShapeshift, probeSource, scoreShapeshift } from './compose.server';
import { openShapeshiftRecords, type ShapeshiftRow } from './records.server';
import { longestPiece, pickShapeshiftModel, rankShapeshiftModels, shapeshiftParameters, spreadModels, type RoutingSignals } from './routing';
import { refusedModels, subjectHasFace } from './signals.server';
import {
  MAX_GENERATIONS, SHAPESHIFT_PREFIX, SOURCE_SECONDS, bestVariation, shapeshiftPrompt, shapeshiftRequest, splitSource,
  type ShapeshiftCandidate, type ShapeshiftMode, type ShapeshiftNote, type ShapeshiftPlan, type ShapeshiftQuality, type ShapeshiftScores, type ShapeshiftStyle, type ShapeshiftView,
} from './contract';

type Request = ReturnType<typeof shapeshiftRequest.parse>;
type Target = Extract<Request, { action: 'plan' | 'produce' }>;
type Job = { node_id: string; state: string; error: string | null; output_json: string | null };
type StoredTake = { modelId: string; modelName: string; providerLabel: string; prompt: string; imageAssetIds: string[]; pieces: { start: number; duration: number }[] };
type StoredResult = { resultAssetId: string; scores: ShapeshiftScores } | null;

const round = (value: number) => Math.round(value * 1000) / 1000;
const service = (model: ShotModel) => model.providerLabel ?? model.providerId ?? model.name;
const nodeId = (take: number, piece: number) => 'take-' + (take + 1) + '-piece-' + String(piece + 1).padStart(2, '0');
const pieceKey = (piece: { start: number; duration: number }) => piece.start.toFixed(3) + '/' + piece.duration.toFixed(3);

/** Subject pictures in order: the request's own first, then the library character's. */
async function subjectImages(projectId: string, request: Target) {
  for (const assetId of request.imageAssetIds) if ((await getProjectAssetById({ projectId, assetId }))?.type !== 'image') throw Error('Subject pictures must be images in this project');
  const character = request.characterId ? (await useCharacterInProject(request.characterId, projectId)).assets.map(asset => asset.assetId) : [];
  return [...new Set([...request.imageAssetIds, ...character])];
}

/** One model per variation: with auto a different usable model family each, best first; a chosen model runs every variation. */
function modelsFor(request: Target, models: ShotModel[], signals: RoutingSignals) {
  const picked = pickShapeshiftModel(models, request.mode, request.modelId, signals);
  return { chosen: spreadModels(request.modelId === 'auto' ? picked.ranked : [picked.chosen], request.mode, request.variations, signals), skipped: picked.skipped };
}

/** What automatic choices learn from: refusals for this account and whether the main picture is a photo of a face. */
async function routingSignals(projectId: string, mainPicture: string | undefined): Promise<RoutingSignals> {
  const h = openShapeshiftRecords();
  let refused: Set<string>;
  try { refused = refusedModels(h); } finally { h.close(); }
  return { refused, realFace: await subjectHasFace(projectId, mainPicture) };
}

/** Everything a run needs, checked before anything is cut or sent. */
async function prepare(projectId: string, request: Target, freshBalances: boolean) {
  const source = await probeSource(projectId, request.sourceAssetId, AbortSignal.timeout(30_000));
  const start = Math.min(request.start ?? 0, source.duration), end = Math.min(request.end ?? source.duration, source.duration), duration = round(end - start);
  if (duration < SOURCE_SECONDS.min) throw Error('Choose at least ' + SOURCE_SECONDS.min + ' seconds of video');
  if (duration > SOURCE_SECONDS.max) throw Error('Choose at most ' + SOURCE_SECONDS.max + ' seconds of video at once');
  const subject = await subjectImages(projectId, request);
  const { chosen, skipped } = modelsFor(request, await listShotModels({ freshBalances }), await routingSignals(projectId, subject[0]));
  const notes: ShapeshiftNote[] = [];
  if (request.modelId === 'auto' && skipped.length) notes.push({ kind: 'skipped', services: [...new Set(skipped.map(service))] });
  const takes = chosen.map((model, index) => {
    const first = chosen.indexOf(model) === index, images = subject.slice(0, model.referenceInputs!.image.max);
    if (first && images.length < subject.length) notes.push({ kind: 'images-trimmed', modelName: model.name, used: images.length, given: subject.length });
    if (!first && request.modelId === 'auto' && !notes.some(note => note.kind === 'repeated' && note.modelName === model.name)) notes.push({ kind: 'repeated', modelName: model.name });
    const prompt = shapeshiftPrompt(request.mode, request.style, request.prompt, images.length);
    const pieces = splitSource(start, duration, longestPiece(model)).map(piece => ({ ...piece, parameters: shapeshiftParameters(model, request.mode, request.quality, piece.duration, source.width, source.height) }));
    const estimates = pieces.map(piece => estimateGenerationStep({ modelId: model.id, prompt, parameters: piece.parameters }, piece.duration));
    return { model, images, prompt, pieces, estimates };
  });
  const generations = takes.reduce((sum, take) => sum + take.pieces.length, 0);
  if (generations > MAX_GENERATIONS) throw Error('This needs ' + generations + ' generations; choose a shorter range or fewer variations (at most ' + MAX_GENERATIONS + ' at once)');
  return { start, duration, subject, takes, notes };
}
type Prepared = Awaited<ReturnType<typeof prepare>>;

function planView(mode: ShapeshiftMode, prepared: Prepared): ShapeshiftPlan {
  return {
    mode, start: prepared.start, duration: prepared.duration, notes: prepared.notes, cost: sumCosts(prepared.takes.flatMap(take => take.estimates)),
    takes: prepared.takes.map(take => ({ modelId: take.model.id, modelName: take.model.name, providerLabel: service(take.model), prompt: take.prompt, imageAssetIds: take.images,
      pieces: take.pieces.map(({ start, duration }) => ({ start, duration })), cost: sumCosts(take.estimates) })),
  };
}

/** Cuts each piece of the source once, then queues every generation of every variation as one durable run. */
async function produce(projectId: string, request: Extract<Request, { action: 'produce' }>) {
  const prepared = await prepare(projectId, request, true);
  const signal = AbortSignal.timeout(10 * 60_000), segments = new Map<string, string>();
  for (const take of prepared.takes) for (const piece of take.pieces) if (!segments.has(pieceKey(piece)))
    segments.set(pieceKey(piece), (await extractProjectVideoSegment({ projectId, assetId: request.sourceAssetId, start: piece.start, duration: piece.duration, signal })).id);
  const nodes: NodeSpec[] = prepared.takes.flatMap((take, t) => take.pieces.map((piece, p) => ({
    id: nodeId(t, p), operation: 'generation.model', version: '1', cache: false,
    input: { schemaVersion: 1, mode: 'video', modelId: take.model.id, prompt: take.prompt, outputIndex: 0, parameters: piece.parameters,
      references: [{ assetId: segments.get(pieceKey(piece))!, kind: 'video', role: 'reference' }, ...take.images.map(assetId => ({ assetId, kind: 'image', role: 'reference' }))] } as unknown as Json,
  })));
  assertRuntimeConfigured(nodes);
  const pinned = await pinRuntimePlan({ projectId, nodes });
  const plan = planView(request.mode, prepared);
  const takes: StoredTake[] = plan.takes.map(({ modelId, modelName, providerLabel, prompt, imageAssetIds, pieces }) => ({ modelId, modelName, providerLabel, prompt, imageAssetIds, pieces }));
  const h = openShapeshiftRecords();
  try {
    const runId = h.enqueue(pinned, SHAPESHIFT_PREFIX + request.requestId);
    h.db.prepare('INSERT OR IGNORE INTO vh_shapeshifts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(request.requestId, projectId, request.mode, request.sourceAssetId, prepared.start, prepared.duration,
      JSON.stringify(prepared.subject), request.characterId ?? null, request.style, request.prompt, request.quality, request.keepSound ? 1 : 0, JSON.stringify(takes), null, Date.now());
    return { runId, generations: nodes.length, plan };
  } finally { h.close(); }
}

async function view(projectId: string, runId: string, row: ShapeshiftRow, jobs: Job[]): Promise<ShapeshiftView> {
  const takes = JSON.parse(row.takes_json) as StoredTake[], results = row.results_json ? JSON.parse(row.results_json) as StoredResult[] : [];
  const byNode = new Map(jobs.map(job => [job.node_id, job]));
  const asset = async (assetId: string | null | undefined) => assetId ? getProjectAssetById({ projectId, assetId }) : null;
  const best = bestVariation(takes.map((_, index) => results[index]?.scores.score ?? null)), source = await asset(row.source_asset_id);
  const variations = await Promise.all(takes.map(async (take, t) => {
    const pieces = await Promise.all(take.pieces.map(async (piece, p) => {
      const job = byNode.get(nodeId(t, p)), output = job?.state === 'succeeded' && job.output_json ? JSON.parse(job.output_json) as { assetId?: string } : null;
      return { index: p, start: piece.start, duration: piece.duration, state: job?.state ?? 'queued', error: job?.error ?? null, outputAssetId: (await asset(output?.assetId))?.id ?? null };
    }));
    const result = results[t] ?? null, file = await asset(result?.resultAssetId);
    return { index: t, modelId: take.modelId, modelName: take.modelName, providerLabel: take.providerLabel, pieces,
      resultAssetId: file?.id ?? null, resultUrl: file?.publicUrl ?? null, scores: file && result ? result.scores : null, best: best === t };
  }));
  return {
    requestId: row.request_id, runId, mode: row.mode as ShapeshiftMode, sourceAssetId: row.source_asset_id, sourceUrl: source?.publicUrl ?? null, start: row.start_seconds, duration: row.duration_seconds,
    imageAssetIds: JSON.parse(row.image_ids_json) as string[], characterId: row.character_id, style: row.style as ShapeshiftStyle, prompt: row.prompt, quality: row.quality as ShapeshiftQuality,
    keepSound: row.keep_sound === 1, createdAt: row.created_at, variations,
  };
}

/** Shapeshifts of a project, newest first, with each piece's state and each variation's result and scores. */
export async function listShapeshifts(projectId: string): Promise<ShapeshiftView[]> {
  const h = openShapeshiftRecords();
  try {
    const runs = (h.runs(projectId) as Array<{ id: string; request_key: string }>).filter(run => run.request_key.startsWith(SHAPESHIFT_PREFIX)).slice(0, 30);
    const views: ShapeshiftView[] = [];
    for (const run of runs) {
      const row = h.db.prepare('SELECT * FROM vh_shapeshifts WHERE request_id=? AND project_id=?').get(run.request_key.slice(SHAPESHIFT_PREFIX.length), projectId) as ShapeshiftRow | undefined;
      if (row) views.push(await view(projectId, run.id, row, h.jobs(run.id) as unknown as Job[]));
    }
    return views;
  } finally { h.close(); }
}

/** Joins and scores every variation whose pieces have all arrived; finished ones are kept as they are. */
async function finish(projectId: string, requestId: string) {
  const find = async () => (await listShapeshifts(projectId)).find(item => item.requestId === requestId);
  const current = await find();
  if (!current) throw Error('Shapeshift not found');
  const results: StoredResult[] = current.variations.map(variation => variation.resultAssetId && variation.scores ? { resultAssetId: variation.resultAssetId, scores: variation.scores } : null);
  const source = { assetId: current.sourceAssetId, start: current.start, duration: current.duration };
  const subject = current.imageAssetIds.length ? { referenceAssetIds: current.imageAssetIds } : { characterId: current.characterId! };
  for (const variation of current.variations) {
    if (results[variation.index] || variation.pieces.some(piece => !piece.outputAssetId)) continue;
    const signal = AbortSignal.timeout(10 * 60_000);
    const resultAssetId = await composeShapeshift({ projectId, requestId, variation: variation.index + 1, quality: current.quality, keepSound: current.keepSound, source,
      pieces: variation.pieces.map(piece => ({ assetId: piece.outputAssetId!, duration: piece.duration })) }, signal);
    results[variation.index] = { resultAssetId, scores: await scoreShapeshift({ projectId, mode: current.mode, resultAssetId, source, subject }, signal) };
    const h = openShapeshiftRecords();
    try { h.db.prepare('UPDATE vh_shapeshifts SET results_json=? WHERE request_id=? AND project_id=?').run(JSON.stringify(results), requestId, projectId); }
    finally { h.close(); }
  }
  return { shapeshift: (await find())! };
}

async function candidates(projectId: string, mode: ShapeshiftMode): Promise<ShapeshiftCandidate[]> {
  const { ranked, skipped } = rankShapeshiftModels(await listShotModels({ freshBalances: true }), mode, await routingSignals(projectId, undefined));
  return [...ranked, ...skipped].map((model, index) => ({ id: model.id, name: model.name, providerLabel: service(model),
    credit: model.credit?.state === 'empty' ? 'empty' as const : model.credit ? 'ok' as const : 'unknown' as const, recommended: index === 0 && ranked.length > 0 }));
}

/** The single operation behind the HTTP route, the Shapeshift page and the MCP tool. */
export async function changeShapeshifts(projectId: string, raw: unknown) {
  const request = shapeshiftRequest.parse(raw);
  if (!await getActiveProject({ projectId })) throw Error('Project not found');
  if (request.action === 'models') return { models: await candidates(projectId, request.mode) };
  if (request.action === 'plan') return { plan: planView(request.mode, await prepare(projectId, request, true)) };
  if (request.action === 'produce') return produce(projectId, request);
  if (request.action === 'list') return { shapeshifts: await listShapeshifts(projectId) };
  return finish(projectId, request.requestId);
}
