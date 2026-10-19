import type { DurableHarness } from './durable';
import { attachMaterializedJob } from './attach-asset';
import { verifySequence } from './sequence-adapter';
import { appendSequence } from '../editor/sequence';
import { createTimelineDocument } from '../editor/timeline-document';
import { loadProjectTimeline } from '../editor/timeline-state';
import { persistViralHitCommand } from '../commands/persist';
import { loadCommandReceiptRecord } from '../commands/receipts';
import { createCommandFailure } from '../commands/contracts';

export async function attachRunResult(h: DurableHarness, projectId: string, runId: string, jobId: string, expectedRevision: number, clipId?: string) {
  if (!h.runs(projectId).some(run => run.id === runId)) throw Error('Run not found in this project');
  const job = h.jobs(runId).find(job => job.id === jobId);
  if (job?.operation !== 'editor.sequence') return attachMaterializedJob(h, projectId, runId, jobId, expectedRevision, clipId);
  if (clipId !== undefined) throw Error('An editable sequence cannot replace a single clip take');
  if (job.state !== 'succeeded' || job.cancel_requested || !job.output_json) throw Error('Select a successfully prepared editable sequence');
  const commandId = `sequence-${job.id}`, idempotencyKey = `harness-sequence:${job.id}`;
  const receipt = await loadCommandReceiptRecord({ projectId, idempotencyKey });
  if (receipt) {
    if (receipt.commandId !== commandId || receipt.commandType !== 'editor.replace_document') throw Error('Sequence receipt identity mismatch');
    return receipt.result;
  }
  const verified = await verifySequence(JSON.parse(job.execution_input_json ?? job.input_json), projectId, AbortSignal.timeout(60_000));
  const output = JSON.parse(job.output_json);
  if (output.sequenceReady !== true || output.digest !== verified.digest) throw Error('Sequence result does not match its prepared edit');
  const current = await loadProjectTimeline(projectId);
  if ((current?.version ?? 0) !== expectedRevision) return createCommandFailure({ projectId, commandId, origin: 'system', code: 'REVISION_CONFLICT', message: 'Timeline changed. Review the latest timeline before adding this sequence.', revision: current?.version ?? 0 });
  const document = appendSequence(current?.document ?? createTimelineDocument({ projectId, name: 'Timeline 1' }), verified.sequence, verified.media, commandId);
  // Only this service assembles the replacement from the exact reviewed revision. Existing tracks are preserved.
  return persistViralHitCommand({ projectId, origin: 'system', commandId, idempotencyKey, expectedRevision, command: { type: 'editor.replace_document', document } });
}
