import { randomUUID } from 'node:crypto';
import { persistExternalCommandWithConflictRetry } from '../commands/conflict-retry';
import { createCommandId, type ViralHitCommandOrigin } from '../commands/contracts';
import { loadProjectTimeline } from '../editor/timeline-state';
import { assertRuntimeConfigured } from '../harness/capabilities';
import { pinRuntimePlan } from '../harness/runtime-plan';
import { openHarness } from '../harness/store';
import { getActiveProject } from '../projects/projects';
import { LOCAL_PROJECT_ASSET_BUCKET, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { probeMedia } from '../harness/probe-media';
import { readSceneOutput } from '../references/scene-contract';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { REMIX_REQUEST_PREFIX, remixRequest, type RemixMaterial, type RemixView } from './contract';
import { assignRemixMaterials, remixGrammar, remixOperations } from './grammar';
import { extractProjectSoundtrack } from './soundtrack.server';

type Job = { node_id: string; state: string; error: string | null; input_json: string; output_json: string | null };

/** Remixes are durable scene-detection runs keyed by request; the grammar is read back from the receipt. */
async function listRemixes(projectId: string): Promise<RemixView[]> {
  const h = openHarness();
  try {
    const runs = (h.runs(projectId) as Array<{ id: string; request_key: string; created_at: number }>).filter(run => run.request_key.startsWith(REMIX_REQUEST_PREFIX)).slice(0, 20);
    const views: RemixView[] = [];
    for (const run of runs) {
      const job = (h.jobs(run.id) as unknown as Job[]).find(item => item.node_id === 'scenes');
      if (!job) continue;
      const sourceAssetId = (JSON.parse(job.input_json) as { assetId: string }).assetId;
      const receipt = job.state === 'succeeded' ? readSceneOutput(job.output_json) : null;
      const asset = await getProjectAssetById({ projectId, assetId: sourceAssetId });
      views.push({
        requestId: run.request_key.slice(REMIX_REQUEST_PREFIX.length), runId: run.id, createdAt: run.created_at,
        sourceAssetId, sourceUrl: asset?.publicUrl ?? null, sourceName: asset?.filename ?? null, state: job.state, error: job.error,
        grammar: receipt ? remixGrammar(receipt.analysis.scenes, receipt.analysis.duration) : null,
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

/** The single application operation behind the Remix page, the HTTP route and the MCP tool. */
export async function changeRemix(projectId: string, raw: unknown, origin: ViralHitCommandOrigin) {
  const request = remixRequest.parse(raw);
  if (!await getActiveProject({ projectId })) throw new Error('Project not found');
  if (request.action === 'list') return { remixes: await listRemixes(projectId) };
  if (request.action === 'analyze') {
    const reference = await getProjectAssetById({ projectId, assetId: request.assetId });
    if (!reference || reference.type !== 'video') throw new Error('Choose a video from this project as the reference.');
    const plan = { projectId, nodes: [{ id: 'scenes', operation: 'reference.scenes', version: '1', cache: false,
      input: { assetId: request.assetId, threshold: request.sensitivity, minDuration: request.minShot, maxScenes: request.maxShots } }] };
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
  const operations = remixOperations({ assignments, offset, idPrefix: 'remix-' + randomUUID().slice(0, 8), transition: request.transition, soundtrack });
  const commandId = createCommandId();
  const result = await persistExternalCommandWithConflictRetry({ input: {
    projectId, origin, commandId, idempotencyKey: commandId, expectedRevision: request.expectedRevision ?? timeline?.version ?? null,
    command: { type: 'editor.apply', operations },
  } });
  if (!result.ok) throw new Error(result.message);
  return {
    revision: result.revision, offset, soundtrack: Boolean(soundtrack),
    shots: assignments.map(({ shot, material: used, length }) => ({ start: offset + shot.start, duration: shot.duration, assetId: used.assetId, filled: length })),
  };
}
