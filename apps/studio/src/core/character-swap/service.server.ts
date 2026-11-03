import type { ViralHitCommandOrigin } from '../commands/contracts';
import { loadProjectTimeline } from '../editor/timeline-state';
import { findTimelineClip } from '../editor/timeline-document';
import { assertRuntimeConfigured } from '../harness/capabilities';
import { pinRuntimePlan } from '../harness/runtime-plan';
import { openSwapRecords } from './records.server';
import type { Json, NodeSpec } from '../harness/durable';
import { getGenerationModelDescriptor } from '../generation-providers/model-catalog';
import { useCharacterInProject } from '../characters/library.server';
import { estimateGenerationStep } from '../costs/generation-cost.server';
import { sumCosts } from '../costs/pricing';
import { getActiveProject } from '../projects/projects';
import { getWorkspaceEffectRegistryEntry } from '../effects/effect-registry';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { extractProjectVideoSegment } from './segment.server';
import { evaluateSwap, placeSwap } from './results.server';
import {
  MAX_SWAP_SECONDS, SWAP_REQUEST_PREFIX, characterSwapPrompt, characterSwapRequest, swapDuration, swapSegments,
  type CharacterSwapPiece, type CharacterSwapPlan, type CharacterSwapView,
} from './contract';

type Request = ReturnType<typeof characterSwapRequest.parse>;
type Target = Extract<Request, { action: 'plan' | 'produce' }>;
type Job = { id: string; node_id: string; state: string; error: string | null; output_json: string | null };
type Row = { request_id: string; clip_id: string; model_id: string; character_id: string | null; image_ids_json: string; keep_sound: number; prompt: string; pieces_json: string; evaluations_json: string | null; created_at: number; placed_at: number | null };

/** A model can swap when it takes at least one reference video and one reference image. */
export function swapModel(modelId: string) {
  const model = getGenerationModelDescriptor(modelId);
  if (!model || model.kind !== 'video' || (model.referenceInputs?.video.max ?? 0) < 1 || (model.referenceInputs?.image.max ?? 0) < 1)
    throw Error('Choose a video model that takes a reference video and reference images');
  return model;
}

/** Everything a run needs, checked before anything is cut or sent. */
async function prepare(projectId: string, request: Target) {
  if (Boolean(request.characterId) === Boolean(request.imageAssetIds?.length)) throw Error('Choose a character or images of the character');
  const model = swapModel(request.modelId);
  const timeline = await loadProjectTimeline(projectId);
  const clip = timeline && findTimelineClip(timeline.document, request.clipId);
  if (!clip || clip.sourceType !== 'video') throw Error('Choose a video clip on the timeline');
  const imageMax = model.referenceInputs!.image.max;
  const images = request.characterId
    ? (await useCharacterInProject(request.characterId, projectId)).assets.map(asset => asset.assetId).slice(0, imageMax)
    : request.imageAssetIds!.slice(0, imageMax);
  for (const assetId of images) if ((await getProjectAssetById({ projectId, assetId }))?.type !== 'image') throw Error('Character references must be project images');
  const entry = getWorkspaceEffectRegistryEntry(model.id), durations = entry?.supportedDurations;
  const longest = Math.min(MAX_SWAP_SECONDS, ...(durations ?? []).map(value => Number.parseInt(value, 10)).filter(Number.isFinite));
  const pieces = swapSegments(clip.inPoint, (clip.outPoint - clip.inPoint), longest).map(piece => ({ ...piece, outputDuration: swapDuration(piece.duration, durations) }));
  const prompt = characterSwapPrompt(request.notes, images.length);
  return { model, clip, images, pieces, prompt, auto: Boolean(entry?.supportedAspectRatios?.includes('auto')) };
}

const pieceNode = (modelId: string, prompt: string, segmentId: string, images: string[], outputDuration: string | null, auto: boolean): NodeSpec['input'] => ({
  schemaVersion: 1, mode: 'video', modelId, prompt, outputIndex: 0,
  references: [{ assetId: segmentId, kind: 'video', role: 'reference' }, ...images.map(assetId => ({ assetId, kind: 'image', role: 'reference' }))],
  parameters: { ...(outputDuration ? { wmDuration: outputDuration } : {}), ...(auto ? { aspect_ratio: 'auto' } : {}) },
}) as unknown as Json;

async function plan(projectId: string, request: Target): Promise<CharacterSwapPlan> {
  const { model, clip, images, pieces, prompt } = await prepare(projectId, request);
  const cost = sumCosts(pieces.map(piece => estimateGenerationStep({ modelId: model.id, prompt, parameters: { ...(piece.outputDuration ? { wmDuration: piece.outputDuration } : {}) } }, piece.duration)));
  return { clipId: clip.id, modelId: model.id, prompt, imageAssetIds: images, pieces, cost };
}

/** Cuts each piece of the clip, then queues one reference-to-video generation per piece as one durable run. */
async function produce(projectId: string, request: Extract<Request, { action: 'produce' }>) {
  const { model, clip, images, pieces, prompt, auto } = await prepare(projectId, request);
  const signal = AbortSignal.timeout(10 * 60_000), segments: { id: string }[] = [];
  for (const piece of pieces) segments.push(await extractProjectVideoSegment({ projectId, assetId: clip.assetId, start: piece.start, duration: piece.duration, signal }));
  const nodes: NodeSpec[] = pieces.map((piece, index) => ({
    id: 'piece-' + String(index + 1).padStart(2, '0'), operation: 'generation.model', version: '1', cache: true,
    input: pieceNode(model.id, prompt, segments[index].id, images, piece.outputDuration, auto),
  }));
  const runPlan = { projectId, nodes };
  assertRuntimeConfigured(runPlan.nodes);
  const pinned = await pinRuntimePlan(runPlan);
  const h = openSwapRecords();
  try {
    const runId = h.enqueue(pinned, SWAP_REQUEST_PREFIX + request.requestId);
    h.db.prepare('INSERT OR IGNORE INTO vh_character_swaps VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(request.requestId, projectId, clip.id, model.id, request.characterId ?? null, JSON.stringify(images),
      request.keepSound ? 1 : 0, prompt, JSON.stringify(pieces.map((piece, index) => ({ start: piece.start, duration: piece.duration, sourceAssetId: segments[index].id }))), null, Date.now(), null);
    return { runId, pieces: pieces.length, cost: sumCosts(nodes.map((node, index) => estimateGenerationStep(node.input, pieces[index].duration))) };
  } finally { h.close(); }
}

/** Swaps of a project (or one clip), newest first, with each piece's state, result and face check. */
export async function listSwaps(projectId: string, clipId?: string): Promise<CharacterSwapView[]> {
  const h = openSwapRecords();
  try {
    const runs = (h.runs(projectId) as Array<{ id: string; request_key: string; created_at: number }>).filter(run => run.request_key.startsWith(SWAP_REQUEST_PREFIX)).slice(0, 30);
    const views: CharacterSwapView[] = [];
    for (const run of runs) {
      const requestId = run.request_key.slice(SWAP_REQUEST_PREFIX.length);
      const row = h.db.prepare('SELECT * FROM vh_character_swaps WHERE request_id=? AND project_id=?').get(requestId, projectId) as Row | undefined;
      if (!row || (clipId && row.clip_id !== clipId)) continue;
      const stored = JSON.parse(row.pieces_json) as { start: number; duration: number; sourceAssetId: string }[];
      const evaluations = row.evaluations_json ? JSON.parse(row.evaluations_json) as CharacterSwapPiece['evaluation'][] : [];
      const jobs = (h.jobs(run.id) as unknown as Job[]).filter(job => job.node_id.startsWith('piece-')).sort((left, right) => left.node_id.localeCompare(right.node_id));
      const pieces = await Promise.all(stored.map(async (piece, index) => {
        const job = jobs[index];
        const output = job?.state === 'succeeded' && job.output_json ? JSON.parse(job.output_json) as { assetId?: string } : null;
        const asset = output?.assetId ? await getProjectAssetById({ projectId, assetId: output.assetId }) : null;
        return { index, ...piece, state: job?.state ?? 'queued', error: job?.error ?? null, outputAssetId: asset?.id ?? null, outputUrl: asset?.publicUrl ?? null, evaluation: evaluations[index] ?? null };
      }));
      views.push({ requestId, runId: run.id, clipId: row.clip_id, modelId: row.model_id, characterId: row.character_id, imageAssetIds: JSON.parse(row.image_ids_json),
        keepSound: row.keep_sound === 1, prompt: row.prompt, createdAt: row.created_at, placedAt: row.placed_at, pieces });
    }
    return views;
  } finally { h.close(); }
}

/** The single operation behind the HTTP route, the editor dialog and the MCP tool. */
export async function changeCharacterSwaps(projectId: string, raw: unknown, origin: ViralHitCommandOrigin) {
  const request = characterSwapRequest.parse(raw);
  if (!await getActiveProject({ projectId })) throw Error('Project not found');
  if (request.action === 'plan') return { plan: await plan(projectId, request) };
  if (request.action === 'produce') return produce(projectId, request);
  if (request.action === 'list') return { swaps: await listSwaps(projectId, request.clipId) };
  const swap = (await listSwaps(projectId)).find(item => item.requestId === request.requestId);
  if (!swap) throw Error('Swap not found');
  if (request.action === 'evaluate') return { swap: await evaluateSwap(projectId, swap) };
  return placeSwap(projectId, swap, origin);
}
