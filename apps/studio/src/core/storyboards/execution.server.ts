import { prepareRecipePlan } from '../harness/recipe-plan';
import { pinRuntimePlan } from '../harness/runtime-plan';
import { assertRuntimeConfigured } from '../harness/capabilities';
import { isAssetOperation, assetOperationKind } from '../harness/asset-operations';
import { openHarness } from '../harness/store';
import type { Plan } from '../harness/durable';
import { sequenceSchema, type EditableSequence } from '../editor/sequence';
import { checkReferences, checkedMedia } from './media.server';
import { recordRun, reserveAction, readAction, digest, shotDigest, StoryboardConflict, type StoryboardAction } from './storage.server';
import type { StoryboardRequest, StoryboardState, StoryboardActionView } from './contract';

export function resumeStoryboardAction(action: StoryboardAction) {
  const h = openHarness();
  try {
    if (action.runId) {
      if (!h.runs(action.projectId).some(run => run.id === action.runId && run.request_key === 'storyboard:' + action.requestId)) throw Error('Recorded storyboard run is missing; restore its ledger instead of submitting replacement work');
      return actionSummary(action, h.jobs(action.runId));
    }
    const runId = h.enqueue(action.plan, 'storyboard:' + action.requestId);
    const saved = recordRun(action, runId);
    return actionSummary(saved, h.jobs(runId));
  } finally { h.close(); }
}
export function actionSummary(action: StoryboardAction, jobs: ReturnType<ReturnType<typeof openHarness>['jobs']> = []): StoryboardActionView {
  const { plan: _, requestDigest: __, ...summary } = action;
  const job = jobs.find(item => item.node_id === action.outputNodeId && item.state === 'succeeded' && !item.cancel_requested && isAssetOperation(item.operation));
  let output: StoryboardActionView['output'];
  if (job?.output_json) {
    const raw = JSON.parse(job.output_json);
    if (typeof raw.assetId === 'string' && typeof raw.sha256 === 'string') output = { assetId: raw.assetId, sha256: raw.sha256 };
  }
  return { ...summary, ...(output ? { output } : {}), jobs: jobs.map(job => ({ id: job.id, nodeId: job.node_id, state: job.state, error: job.error })) };
}
export async function storyboardSequence(state: StoryboardState): Promise<EditableSequence> {
  const assets: EditableSequence['assets'] = {}, tracks: EditableSequence['tracks'] = [];
  const visual: EditableSequence['tracks'][number] = { id: 'shots', name: 'Storyboard shots', kind: 'video', clips: [] };
  const captions: EditableSequence['tracks'][number] = { id: 'captions', name: 'Storyboard captions', kind: 'caption', clips: [] };
  const names = new Map<string, string>();
  function source(assetId: string, kind: 'image' | 'video' | 'audio') {
    const previous = names.get(assetId); if (previous) return previous;
    const key = 'source-' + names.size; names.set(assetId, key); assets[key] = { assetId, kind }; return key;
  }
  let startTime = 0;
  for (const [index, shot] of state.plan.shots.entries()) {
    const accepted = state.accepted[shot.id];
    if (!accepted || accepted.shotDigest !== shotDigest(state.plan, shot)) throw Error('Every current shot needs an accepted result before assembly: ' + shot.id);
    const asset = await checkedMedia(state.projectId, accepted.assetId, accepted.sha256);
    if (asset.type !== accepted.kind) throw Error('Accepted media kind changed');
    visual.clips.push({ id: 'shot-' + index, type: 'media', source: source(asset.id, asset.type), startTime, duration: shot.duration,
      inPoint: accepted.inPoint, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 });
    if (shot.caption.trim()) captions.clips.push({ id: 'caption-' + index, type: 'caption', text: shot.caption, startTime, duration: shot.duration });
    startTime += shot.duration;
  }
  tracks.push(visual); if (captions.clips.length) tracks.push(captions);
  for (const [index, audio] of state.plan.audio.entries()) {
    tracks.push({ id: 'audio-' + index, name: audio.role, kind: 'audio', clips: [{
      id: 'audio-clip-' + index, type: 'media', source: source(audio.assetId, 'audio'), startTime: audio.startTime,
      duration: audio.duration, inPoint: audio.inPoint, volume: audio.volume, audioRole: audio.role, muted: false, fadeIn: 0, fadeOut: 0,
    }] });
  }
  if (names.size > 16) throw Error('An editable sequence supports up to 16 distinct media assets');
  return sequenceSchema.parse({ schemaVersion: 1, title: state.plan.title, assets, tracks });
}
export async function enqueueStoryboard(state: StoryboardState, request: Extract<StoryboardRequest, { action: 'generate' | 'assemble' }>) {
  const old = readAction(state.projectId, state.id, request.requestId);
  if (old) {
    if (old.requestDigest !== digest(request)) throw new StoryboardConflict('Request ID belongs to a different storyboard action');
    return resumeStoryboardAction(old);
  }
  if (state.revision !== request.expectedRevision) throw new StoryboardConflict('Storyboard changed. Read the current plan and review again.');
  await checkReferences(state.projectId, state.plan);
  let plan: Plan, outputNodeId: string, shotId: string | undefined, shotHash: string | undefined;
  if (request.action === 'generate') {
    const shot = state.plan.shots.find(shot => shot.id === request.shotId);
    if (!shot?.recipe) throw Error('Choose a current shot with an explicit recipe and input values');
    plan = await prepareRecipePlan(shot.recipe.id, shot.recipe.values, state.projectId, shot.recipe.digest);
    const output = plan.nodes.find(node => node.id === shot.recipe!.outputNodeId);
    if (!output || !isAssetOperation(output.operation) || !['image', 'video'].includes(String(assetOperationKind(output.operation, output.input)))) throw Error('The shot output node must materialize an image or video');
    outputNodeId = output.id; shotId = shot.id; shotHash = shotDigest(state.plan, shot);
  } else {
    outputNodeId = 'sequence';
    plan = { projectId: state.projectId, nodes: [{ id: outputNodeId, operation: 'editor.sequence', version: '1', input: await storyboardSequence(state) }] };
  }
  assertRuntimeConfigured(plan.nodes);
  const pinned = await pinRuntimePlan(plan);
  const action = reserveAction({ projectId: state.projectId, boardId: state.id, requestId: request.requestId, kind: request.action,
    revision: state.revision, shotId, shotDigest: shotHash, outputNodeId, requestDigest: digest(request), plan: pinned, runId: null });
  return resumeStoryboardAction(action);
}
