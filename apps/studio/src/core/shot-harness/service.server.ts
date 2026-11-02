import { openHarness } from '../harness/store';
import { pinRuntimePlan } from '../harness/runtime-plan';
import { assertRuntimeConfigured } from '../harness/capabilities';
import { getActiveProject } from '../projects/projects';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { listShotModels } from './catalog.server';
import { SHOT_REQUEST_PREFIX, shotRequest, type ShotRunView, type ShotTakeView } from './contract';
import { prepareShot, shotPlan, type ShotProduction } from './plan';
import { inspectTake } from './quality.server';

const publicStep = (step: ShotProduction['video']) => ({
  modelId: step.model.id, modelName: step.model.name, provider: step.model.providerLabel ?? step.model.providerId ?? '',
  prompt: step.prompt, dropped: step.dropped, parameters: step.parameters,
});
const publicProduction = (production: ShotProduction) => ({
  still: production.still ? publicStep(production.still) : null, video: publicStep(production.video),
  variations: production.spec.variations, notes: production.notes, alternatives: production.alternatives,
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
    const runs = (h.runs(projectId) as Array<{ id: string; request_key: string; created_at: number }>).filter(run => run.request_key.startsWith(SHOT_REQUEST_PREFIX)).slice(0, 40);
    const views: ShotRunView[] = [];
    for (const run of runs) {
      const jobs = h.jobs(run.id) as unknown as Job[];
      const takes = jobs.filter(job => job.node_id.startsWith('take-')), still = jobs.find(job => job.node_id === 'still');
      if (!takes.length) continue;
      const input = JSON.parse(takes[0].input_json) as { prompt: string; modelId: string; parameters?: { wmDuration?: string; provider_options?: { generate_audio?: boolean; sound?: string } } };
      const options = input.parameters?.provider_options;
      views.push({
        runId: run.id, requestId: run.request_key.slice(SHOT_REQUEST_PREFIX.length), createdAt: run.created_at,
        prompt: input.prompt, modelId: input.modelId, stillModelId: still ? (JSON.parse(still.input_json) as { modelId: string }).modelId : null,
        durationSec: input.parameters?.wmDuration ? Number.parseFloat(input.parameters.wmDuration) : null,
        audio: options?.generate_audio === true || options?.sound === 'on',
        still: still ? await takeView(projectId, still) : null, takes: await Promise.all(takes.map(job => takeView(projectId, job))),
      });
    }
    return views;
  } finally { h.close(); }
}

/** The single application operation behind the HTTP route and the MCP tool. */
export async function changeShots(projectId: string, raw: unknown) {
  const request = shotRequest.parse(raw);
  if (!await getActiveProject({ projectId })) throw Error('Project not found');
  if (request.action === 'list') return { shots: await listShots(projectId) };
  if (request.action === 'quality') return { quality: await inspectTake(projectId, request.assetId, { durationSec: request.durationSec, audio: request.audio }) };
  const production = prepareShot(request.spec, await listShotModels());
  if (request.action === 'preview') return { production: publicProduction(production) };
  const plan = shotPlan(projectId, production);
  assertRuntimeConfigured(plan.nodes);
  const pinned = await pinRuntimePlan(plan);
  const h = openHarness();
  try { return { runId: h.enqueue(pinned, SHOT_REQUEST_PREFIX + request.requestId), production: publicProduction(production) }; }
  finally { h.close(); }
}
