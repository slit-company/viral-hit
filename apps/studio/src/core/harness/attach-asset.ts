import { createHash } from 'node:crypto';
import { loadProjectTimeline } from '../editor/timeline-state';
import { findTimelineClip } from '../editor/timeline-document';
import type { DurableHarness } from './durable';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { persistViralHitCommand } from '../commands/persist';
import { resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { fileHash } from './materialize';

export async function attachMaterializedJob(h: DurableHarness, projectId: string, runId: string, jobId: string, expectedRevision: number, clipId?: string) {
  if (!h.runs(projectId).some(run => run.id === runId)) throw new Error('Run not found in this project');
  const job = h.jobs(runId).find(job => job.id === jobId);
  if (!job || job.operation !== 'asset.materialize' || job.state !== 'succeeded' || job.cancel_requested || !job.output_json) throw new Error('Select a successfully imported media job');
  const output = JSON.parse(job.output_json);
  const asset = await getProjectAssetById({ projectId, assetId: output.assetId });
  if (!asset || !asset.sha256 || asset.sha256 !== output.sha256 || await fileHash(resolveLocalProjectAssetPath({ objectKey: asset.objectKey })) !== asset.sha256) throw new Error('Local media is unavailable or its content hash changed');
  if (clipId !== undefined) {
    const timeline = await loadProjectTimeline(projectId);
    const clip = timeline && findTimelineClip(timeline.document, clipId);
    if (!clip) throw new Error('Target clip not found in this project');
    if (clip.sourceType !== asset.type) throw new Error('Choose a clip of the same media kind');
    const sourceDuration = asset.type === 'image' ? clip.duration : (asset.durationMs ?? 0) / 1000;
    if (sourceDuration < clip.duration - 0.05) throw new Error('Generated media is shorter than the target clip');
    // One import per job/clip. Replaying a lost response cannot create another
    // take or reactivate one after the user has restored the original.
    const takeId = `harness-take-${createHash('sha256').update(JSON.stringify([job.id, clipId])).digest('hex')}`;
    return persistViralHitCommand({
      projectId, origin: 'system', commandId: takeId, expectedRevision,
      idempotencyKey: takeId,
      command: { type: 'editor.apply', operations: [
        { type: 'add_take', clipId, take: {
          id: takeId, assetId: asset.id, sourceUrl: asset.publicUrl,
          name: asset.filename ?? 'Generated media', sourceType: asset.type,
          sourceDuration, sourceGenerationId: job.id, prompt: '',
          createdAt: new Date().toISOString(),
        } },
        { type: 'activate_take', clipId, takeId },
      ] },
    });
  }
  return persistViralHitCommand({
    projectId, origin: 'system', commandId: job.id, expectedRevision,
    idempotencyKey: `harness-attach:${job.id}`,
    command: { type: 'editor.apply', operations: [{
      type: 'add_clip', clipId: `harness-${job.id}`, assetId: asset.id,
      sourceUrl: asset.publicUrl, name: asset.filename ?? 'Generated media',
      sourceType: asset.type, sourceDuration: asset.type === 'image' ? 3 : (asset.durationMs ?? 0) / 1000,
    }] },
  });
}
