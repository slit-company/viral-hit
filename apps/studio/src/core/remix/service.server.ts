import { randomUUID } from 'node:crypto';
import { persistExternalCommandWithConflictRetry } from '../commands/conflict-retry';
import { createCommandId, type ViralHitCommandOrigin } from '../commands/contracts';
import { loadProjectTimeline } from '../editor/timeline-state';
import { getTimelineClipSource, type TimelineDocument } from '../editor/timeline-document';
import { timelineOutputFrame } from '../editor/output-frame';
import { assertRuntimeConfigured } from '../harness/capabilities';
import { pinRuntimePlan } from '../harness/runtime-plan';
import { openHarness } from '../harness/store';
import type { Plan } from '../harness/durable';
import { getActiveProject } from '../projects/projects';
import { LOCAL_PROJECT_ASSET_BUCKET, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { probeMedia } from '../harness/probe-media';
import { readSceneOutput } from '../references/scene-contract';
import { readGrammarOutput } from './grammar-contract';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { REMIX_REQUEST_PREFIX, remixRequest, type RemixAssignment, type RemixGrammar, type RemixMaterial, type RemixView } from './contract';
import { assignRemixMaterials } from './grammar';
import { remixGrammar } from './grammar-read';
import { remixOperations } from './rebuild';
import { extractProjectSoundtrack } from './soundtrack.server';

type Job = { node_id: string; state: string; error: string | null; input_json: string; output_json: string | null };

/** Remixes are durable scene-detection runs keyed by request; the grammar is read back from the receipt. */
async function listRemixes(projectId: string): Promise<RemixView[]> {
  const h = openHarness();
  try {
    const runs = (h.runs(projectId) as Array<{ id: string; request_key: string; created_at: number }>).filter(run => run.request_key.startsWith(REMIX_REQUEST_PREFIX)).slice(0, 20);
    const views: RemixView[] = [];
    for (const run of runs) {
      const jobs = h.jobs(run.id) as unknown as Job[], job = jobs.find(item => item.node_id === 'scenes'), edit = jobs.find(item => item.node_id === 'grammar');
      if (!job) continue;
      const sourceAssetId = (JSON.parse(job.input_json) as { assetId: string }).assetId;
      const receipt = job.state === 'succeeded' ? readSceneOutput(job.output_json) : null;
      const analysis = edit?.state === 'succeeded' ? readGrammarOutput(edit.output_json)?.analysis ?? null : null;
      const readText = edit ? (JSON.parse(edit.input_json) as { text?: boolean }).text !== false : true;
      const asset = await getProjectAssetById({ projectId, assetId: sourceAssetId });
      views.push({
        requestId: run.request_key.slice(REMIX_REQUEST_PREFIX.length), runId: run.id, createdAt: run.created_at,
        sourceAssetId, sourceUrl: asset?.publicUrl ?? null, sourceName: asset?.filename ?? null, state: job.state, error: job.error,
        grammar: receipt ? remixGrammar(receipt.analysis.scenes, receipt.analysis.duration, analysis, readText) : null,
        edit: edit ? { state: edit.state, error: edit.error } : null,
      });
    }
    return views;
  } finally { h.close(); }
}

async function material(projectId: string, assetId: string): Promise<RemixMaterial> {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || (asset.type !== 'image' && asset.type !== 'video')) throw new Error(`${assetId} is not an image or video in this project.`);
  let durationMs = asset.durationMs ?? null;
  // Uploads do not always record a duration; measure the local file instead of guessing.
  if (asset.type === 'video' && !(durationMs && durationMs > 0) && asset.bucket === LOCAL_PROJECT_ASSET_BUCKET && asset.objectKey) {
    durationMs = (await probeMedia(resolveLocalProjectAssetPath({ objectKey: asset.objectKey }), 'video', AbortSignal.timeout(20_000))).durationMs;
  }
  if (asset.type === 'video' && !(durationMs && durationMs > 0)) throw new Error(`${asset.filename ?? assetId} has no known duration.`);
  return { assetId, kind: asset.type, duration: asset.type === 'video' ? durationMs! / 1000 : null, name: asset.filename?.trim() || (asset.type === 'video' ? 'Video' : 'Image') };
}

/**
 * Frame and image shapes for camera moves. Both exporters size the frame from the first visible visual clip:
 * after this build that is the timeline's existing first visual or the remix's first shot.
 */
/** Recorded size, or the local file's measured size: uploads do not always record dimensions. */
async function assetSize(projectId: string, assetId: string) {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset) return null;
  if (asset.width && asset.height) return { width: asset.width, height: asset.height };
  if (asset.bucket !== LOCAL_PROJECT_ASSET_BUCKET || !asset.objectKey || (asset.type !== 'image' && asset.type !== 'video')) return null;
  const probe = await probeMedia(resolveLocalProjectAssetPath({ objectKey: asset.objectKey }), asset.type, AbortSignal.timeout(20_000)).catch(() => null);
  return probe?.width && probe.height ? { width: probe.width, height: probe.height } : null;
}
async function cameraContext(projectId: string, document: TimelineDocument | undefined, assignments: readonly RemixAssignment[], grammar: RemixGrammar) {
  const existing = document?.tracks.filter(track => track.kind === 'video' && !track.hidden && !track.muted).flatMap(track => track.clips).find(clip => clip.sourceType === 'image' || clip.sourceType === 'video');
  const firstId = existing ? getTimelineClipSource(existing).assetId : assignments[0]?.material.assetId;
  const first = firstId ? await assetSize(projectId, firstId) : null;
  const frame = first ? timelineOutputFrame(first.width, first.height) : timelineOutputFrame(grammar.edit?.frame.width ?? 16, grammar.edit?.frame.height ?? 9);
  const imageAspects = new Map<string, number>();
  for (const { material: item } of assignments) {
    if (item.kind !== 'image' || imageAspects.has(item.assetId)) continue;
    const size = await assetSize(projectId, item.assetId);
    if (size) imageAspects.set(item.assetId, size.width / size.height);
  }
  return { frameAspect: frame.width / frame.height, imageAspects };
}

/** The single application operation behind the Remix page, the HTTP route and the MCP tool. */
export async function changeRemix(projectId: string, raw: unknown, origin: ViralHitCommandOrigin) {
  const request = remixRequest.parse(raw);
  if (!await getActiveProject({ projectId })) throw new Error('Project not found');
  if (request.action === 'list') return { remixes: await listRemixes(projectId) };
  if (request.action === 'analyze') {
    const reference = await getProjectAssetById({ projectId, assetId: request.assetId });
    if (!reference || reference.type !== 'video') throw new Error('Choose a video from this project as the reference.');
    // Cuts and the edit analysis (camera, pace, on-screen text) run side by side on the same pinned video.
    const plan: Plan = { projectId, nodes: [{ id: 'scenes', operation: 'reference.scenes', version: '1', cache: false,
      input: { assetId: request.assetId, threshold: request.sensitivity, minDuration: request.minShot, maxScenes: request.maxShots } },
    { id: 'grammar', operation: 'reference.grammar', version: '1', cache: false, input: { assetId: request.assetId, text: request.readText } }] };
    assertRuntimeConfigured(plan.nodes);
    const pinned = await pinRuntimePlan(plan);
    const h = openHarness();
    try { return { runId: h.enqueue(pinned, REMIX_REQUEST_PREFIX + request.requestId) }; }
    finally { h.close(); }
  }
  const remix = (await listRemixes(projectId)).find(item => item.requestId === request.requestId);
  if (!remix?.grammar) throw new Error(remix ? 'The reference is still being analysed.' : 'Remix analysis not found.');
  const materials = await Promise.all(request.materials.map(assetId => material(projectId, assetId)));
  const assignments = assignRemixMaterials(remix.grammar, materials);
  const soundtrack = request.keepSoundtrack ? await extractProjectSoundtrack({ projectId, assetId: remix.sourceAssetId, signal: AbortSignal.timeout(150_000) }) : null;
  const timeline = await loadProjectTimeline(projectId);
  const offset = timeline?.document.duration ?? 0;
  const camera = request.keepCamera && remix.grammar.edit ? await cameraContext(projectId, timeline?.document, assignments, remix.grammar) : null;
  const texts = request.keepText ? remix.grammar.edit?.texts ?? [] : [];
  const operations = remixOperations({ assignments, offset, idPrefix: 'remix-' + randomUUID().slice(0, 8), transition: request.transition, soundtrack, camera, texts, speed: request.keepSpeed });
  const commandId = createCommandId();
  const result = await persistExternalCommandWithConflictRetry({ input: {
    projectId, origin, commandId, idempotencyKey: commandId, expectedRevision: request.expectedRevision ?? timeline?.version ?? null,
    command: { type: 'editor.apply', operations },
  } });
  if (!result.ok) throw new Error(result.message);
  return {
    revision: result.revision, offset, soundtrack: Boolean(soundtrack),
    cameraMoves: operations.filter(operation => operation.type === 'set_overlay_motion').length, texts: operations.filter(operation => operation.type === 'upsert_caption').length,
    speedChanges: operations.filter(operation => operation.type === 'set_clip_speed').length,
    shots: assignments.map(({ shot, material: used, length }) => ({ start: offset + shot.start, duration: shot.duration, assetId: used.assetId, filled: length })),
  };
}
