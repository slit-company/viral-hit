import { getActiveProject } from '../projects/projects';
import { openHarness } from '../harness/store';
import { isAssetOperation } from '../harness/asset-operations';
import { storyboardRequest, MAX_STORYBOARD_BYTES, type StoryboardState, type StoryboardRequest, type AcceptedShot } from './contract';
import { changeStoryboard, listStoryboards, readStoryboard, readAction, listActions, shotDigest, StoryboardConflict } from './storage.server';
import { checkReferences, checkedMedia } from './media.server';
import { enqueueStoryboard, resumeStoryboardAction, actionSummary } from './execution.server';

function current(projectId: string, id: string, revision?: number) {
  const state = readStoryboard(projectId, id, revision);
  if (!state) throw Error('Storyboard not found in this project');
  return state;
}
function view(state: StoryboardState) {
  const actions = listActions(state.projectId, state.id);
  if (!actions.length) return { ...state, actions: [] };
  const h = openHarness();
  try { return { ...state, actions: actions.map(action => actionSummary(action, action.runId ? h.jobs(action.runId) : [])) }; }
  finally { h.close(); }
}
async function acceptShot(state: StoryboardState, request: Extract<StoryboardRequest, { action: 'accept' }>) {
  const shot = state.plan.shots.find(shot => shot.id === request.shotId);
  if (!shot) throw Error('Shot not found');
  let assetId: string, sha256: string, sourceActionId: string | undefined;
  if (request.source.kind === 'asset') ({ assetId, sha256 } = request.source);
  else {
    const action = readAction(state.projectId, state.id, request.source.requestId);
    if (!action || action.kind !== 'generate' || action.shotId !== shot.id || action.shotDigest !== shotDigest(state.plan, shot) || !action.runId) throw Error('Generation does not belong to this current shot; review a matching attempt');
    const h = openHarness();
    try {
      if (!h.runs(state.projectId).some(run => run.id === action.runId)) throw Error('Generation project mismatch');
      const job = h.jobs(action.runId).find(job => job.node_id === action.outputNodeId);
      if (!job || !isAssetOperation(job.operation) || job.state !== 'succeeded' || job.cancel_requested || !job.output_json) throw Error('Shot result is not successfully materialized');
      const output = JSON.parse(job.output_json);
      if (typeof output.assetId !== 'string' || typeof output.sha256 !== 'string') throw Error('Generation receipt lacks media identity');
      assetId = output.assetId; sha256 = output.sha256; sourceActionId = action.requestId;
    } finally { h.close(); }
  }
  await checkReferences(state.projectId, state.plan);
  const asset = await checkedMedia(state.projectId, assetId, sha256);
  if (asset.type !== 'image' && asset.type !== 'video') throw Error('A storyboard shot needs an image or video');
  if (asset.type === 'image' ? request.inPoint !== 0 : request.inPoint + shot.duration > (asset.durationMs ?? 0) / 1000) throw Error('Accepted shot exceeds its media duration');
  const accepted: AcceptedShot = { assetId, sha256, kind: asset.type, inPoint: request.inPoint, shotDigest: shotDigest(state.plan, shot),
    notes: request.notes, acceptedAt: new Date().toISOString(), ...(sourceActionId ? { sourceActionId } : {}) };
  return changeStoryboard(state.projectId, state.id, request.expectedRevision, previous => {
    if (!previous || shotDigest(previous.plan, previous.plan.shots.find(item => item.id === shot.id)!) !== accepted.shotDigest) throw new StoryboardConflict('Shot changed during review');
    return { plan: previous.plan, accepted: { ...previous.accepted, [shot.id]: accepted } };
  });
}
export async function changeStoryboards(projectId: string, raw: unknown) {
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_STORYBOARD_BYTES) throw Error('Storyboard request exceeds 256 KB');
  const request = storyboardRequest.parse(raw);
  if (!await getActiveProject({ projectId })) throw Error('Project not found');
  if (request.action === 'list') return listStoryboards(projectId);
  if (request.action === 'read') return view(current(projectId, request.id, request.revision));
  if (request.action === 'save') {
    await checkReferences(projectId, request.plan);
    return changeStoryboard(projectId, request.id, request.expectedRevision, previous => {
      const accepted: Record<string, AcceptedShot> = {};
      for (const shot of request.plan.shots) {
        const old = previous?.accepted[shot.id];
        if (old?.shotDigest === shotDigest(request.plan, shot)) accepted[shot.id] = old;
      }
      return { plan: request.plan, accepted };
    });
  }
  if (request.action === 'resume') {
    const action = readAction(projectId, request.id, request.requestId);
    if (!action) throw Error('Storyboard action not found');
    return resumeStoryboardAction(action);
  }
  const state = current(projectId, request.id);
  if (request.action === 'accept') return acceptShot(state, request);
  return enqueueStoryboard(state, request);
}
