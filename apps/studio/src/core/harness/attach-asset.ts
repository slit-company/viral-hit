import type { DurableHarness } from './durable';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { persistViralHitCommand } from '../commands/persist';
import { resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { fileHash } from './materialize';

export async function attachMaterializedJob(h: DurableHarness, projectId: string, runId: string, jobId: string, expectedRevision: number) {
  if (!h.runs(projectId).some(run => run.id === runId)) throw new Error('Run not found in this project');
  const job = h.jobs(runId).find(job => job.id === jobId);
  if (!job || job.operation !== 'asset.materialize' || job.state !== 'succeeded' || job.cancel_requested || !job.output_json) throw new Error('Select a successfully imported media job');
  const output = JSON.parse(job.output_json);
  const asset = await getProjectAssetById({ projectId, assetId: output.assetId });
  if (!asset || !asset.sha256 || asset.sha256 !== output.sha256 || await fileHash(resolveLocalProjectAssetPath({ objectKey: asset.objectKey })) !== asset.sha256) throw new Error('Local media is unavailable or its content hash changed');
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
