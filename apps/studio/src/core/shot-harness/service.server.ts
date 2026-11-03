import { createHash } from 'node:crypto';
import { openHarness } from '../harness/store';
import { pinRuntimePlan } from '../harness/runtime-plan';
import { assertRuntimeConfigured } from '../harness/capabilities';
import { getActiveProject } from '../projects/projects';
import { extractProjectVideoFrame } from '../projects/extract-project-video-frame';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { listShotModels } from './catalog.server';
import { SHOT_REQUEST_PREFIX, shotRequest, type ShotRunView, type ShotTakeView } from './contract';
import { prepareShot, shotPlan, type ShotProduction } from './plan';
import { inspectTake } from './quality.server';
import { checkFaceMatch } from '../characters/face-match.server';
import { placeShot, readShotRecords } from './records.server';
import { shotSpec, type ShotSpec } from './spec';
import { estimateGenerationStep } from '../costs/generation-cost.server';
import { sumCosts } from '../costs/pricing';

const publicStep = (step: ShotProduction['video']) => ({
  modelId: step.model.id, modelName: step.model.name, provider: step.model.providerLabel ?? step.model.providerId ?? '',
  prompt: step.prompt, dropped: step.dropped, parameters: step.parameters,
});
const publicProduction = (production: ShotProduction) => ({
  still: production.still ? publicStep(production.still) : null, video: publicStep(production.video),
  variations: production.spec.variations, notes: production.notes, alternatives: production.alternatives,
  /** The still once plus every take, from each model's published price. */
  cost: sumCosts([...(production.still ? [production.still] : []), ...Array.from({ length: production.spec.variations }, () => production.video)]
    .map(step => estimateGenerationStep({ modelId: step.model.id, prompt: step.prompt, parameters: step.parameters }))),
});
type Job = { id: string; node_id: string; state: string; error: string | null; input_json: string; output_json: string | null };

async function takeView(projectId: string, job: Job): Promise<ShotTakeView> {
  const view: ShotTakeView = { jobId: job.id, nodeId: job.node_id, state: job.state, error: job.error };
  const output = job.state === 'succeeded' && job.output_json ? JSON.parse(job.output_json) as { assetId?: unknown } : null;
  if (typeof output?.assetId === 'string') {
    const asset = await getProjectAssetById({ projectId, assetId: output.assetId });
    if (asset) Object.assign(view, { assetId: asset.id, url: asset.publicUrl });
  }
  return view;
}

/** Shots are durable runs keyed by request; listing reads them back from the harness ledger. */
async function listShots(projectId: string): Promise<ShotRunView[]> {
  const h = openHarness();
  try {
    const records = readShotRecords(h, projectId);
    const runs = (h.runs(projectId) as Array<{ id: string; request_key: string; created_at: number }>).filter(run => run.request_key.startsWith(SHOT_REQUEST_PREFIX)).slice(0, 40);
    const views: ShotRunView[] = [];
    for (const run of runs) {
      const jobs = h.jobs(run.id) as unknown as Job[];
      const takes = jobs.filter(job => job.node_id.startsWith('take-')), still = jobs.find(job => job.node_id === 'still');
      if (!takes.length) continue;
      const input = JSON.parse(takes[0].input_json) as { prompt: string; modelId: string; parameters?: { wmDuration?: string; provider_options?: { generate_audio?: boolean; sound?: string } } };
      const options = input.parameters?.provider_options;
      const requestId = run.request_key.slice(SHOT_REQUEST_PREFIX.length), record = records.get(requestId);
      const spec = record ? shotSpec.safeParse(record.spec) : null;
      views.push({
        runId: run.id, requestId, createdAt: run.created_at,
        prompt: input.prompt, modelId: input.modelId, stillModelId: still ? (JSON.parse(still.input_json) as { modelId: string }).modelId : null,
        durationSec: input.parameters?.wmDuration ? Number.parseFloat(input.parameters.wmDuration) : null,
        audio: options?.generate_audio === true || options?.sound === 'on',
        still: still ? await takeView(projectId, still) : null, takes: await Promise.all(takes.map(job => takeView(projectId, job))),
        sequenceId: record?.sequenceId ?? requestId, shotId: record?.shotId ?? requestId, position: record?.position ?? 1, attempt: 1,
        spec: spec?.success ? spec.data as ShotSpec : null, continuesFrom: record?.continuesFrom ?? null,
      });
    }
    const attempts = new Map<string, ShotRunView[]>();
    for (const view of views) attempts.set(view.sequenceId + '/' + view.shotId, [...(attempts.get(view.sequenceId + '/' + view.shotId) ?? []), view]);
    for (const group of attempts.values()) [...group].sort((left, right) => left.createdAt - right.createdAt).forEach((view, index) => { view.attempt = index + 1; });
    return views;
  } finally { h.close(); }
}

/** A take's last frame becomes a project image; the same take always yields the same frame asset. */
async function continueFrom(projectId: string, assetId: string) {
  const derivedAssetId = 'tail-' + createHash('sha256').update(projectId + '\0' + assetId).digest('hex').slice(0, 32);
  const frame = await extractProjectVideoFrame({ projectId, assetId, position: 'last', derivedAssetId, purpose: 'continuation_first_frame' });
  return { frame: { assetId: frame.id, url: frame.publicUrl, width: frame.width, height: frame.height, sourceAssetId: assetId } };
}

/** The single application operation behind the HTTP route and the MCP tool. */
export async function changeShots(projectId: string, raw: unknown) {
  const request = shotRequest.parse(raw);
  if (!await getActiveProject({ projectId })) throw Error('Project not found');
  if (request.action === 'list') return { shots: await listShots(projectId) };
  if (request.action === 'quality') return { quality: await inspectTake(projectId, request.assetId, { durationSec: request.durationSec, audio: request.audio }) };
  if (request.action === 'continue') return continueFrom(projectId, request.assetId);
  if (request.action === 'face') return { faceMatch: await checkFaceMatch(projectId, request) };
  const production = prepareShot(request.spec, await listShotModels({ freshBalances: request.action === 'produce' }));
  if (request.action === 'preview') return { production: publicProduction(production) };
  const plan = shotPlan(projectId, production);
  assertRuntimeConfigured(plan.nodes);
  const pinned = await pinRuntimePlan(plan);
  const h = openHarness();
  try {
    const runId = h.enqueue(pinned, SHOT_REQUEST_PREFIX + request.requestId);
    const placement = placeShot(h, projectId, {
      requestId: request.requestId, sequenceId: request.sequence?.id ?? request.requestId, shotId: request.sequence?.shotId ?? request.requestId,
      spec: production.spec, continuesFrom: request.sequence?.continuesFrom ?? null,
    });
    return { runId, placement: { sequenceId: placement.sequenceId, shotId: placement.shotId, position: placement.position }, production: publicProduction(production) };
  } finally { h.close(); }
}
