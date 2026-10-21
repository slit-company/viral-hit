import { createHash } from 'node:crypto';
import { openHarness } from '../harness/store';
import { readSceneOutput } from '../references/scene-contract';
import { readTranscriptOutput } from '../transcripts/contract';
import { checkedMedia } from './media.server';
import { buildReferencePlan } from './reference-plan';
import type { ReferenceJob, ReferenceSources, ReferenceSource, PrepareReference } from './reference-input';
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
function readJob(projectId: string, ref: ReferenceJob) {
  const h = openHarness();
  try {
    if (!h.runs(projectId).some(run => run.id === ref.runId)) throw Error('Analysis run does not belong to this project');
    const job = h.jobs(ref.runId).find(job => job.id === ref.jobId);
    if (!job || job.state !== 'succeeded' || job.cancel_requested || !job.output_json || hash(job.output_json) !== ref.outputSha256) throw Error('Analysis is unavailable, changed or not successfully completed');
    return job;
  } finally { h.close(); }
}
export function listReferenceSources(projectId: string): ReferenceSources {
  const h = openHarness();
  try {
    const sources: ReferenceSource[] = [];
    for (const run of h.runs(projectId)) for (const job of h.jobs(String(run.id))) {
      if (job.state !== 'succeeded' || job.cancel_requested || !job.output_json) continue;
      const scenes = readSceneOutput(job.output_json), transcript = readTranscriptOutput(job.output_json);
      const identity = { runId: String(run.id), jobId: job.id, outputSha256: hash(job.output_json) };
      if (scenes?.projectId === projectId) sources.push({ ...identity, assetId: scenes.assetId, sha256: scenes.sha256, kind: 'scenes', label: scenes.analysis.algorithm, count: scenes.analysis.scenes.length, start: 0, end: scenes.analysis.duration });
      else if (transcript?.source.projectId === projectId && transcript.source.kind === 'video') sources.push({ ...identity, assetId: transcript.source.assetId, sha256: transcript.source.sha256, kind: 'transcript', label: `${transcript.engine.id} · ${transcript.language}`, count: transcript.segments.length, start: transcript.range.start, end: transcript.range.end });
    }
    return { sources: sources.slice(0, 100), omitted: Math.max(0, sources.length - 100) };
  } finally { h.close(); }
}
export async function prepareReferencePlan(projectId: string, request: PrepareReference) {
  const scenes = readSceneOutput(readJob(projectId, request.scenes).output_json);
  if (!scenes || scenes.projectId !== projectId) throw Error('Select a valid visual scene analysis');
  const transcript = request.transcript ? readTranscriptOutput(readJob(projectId, request.transcript).output_json) : null;
  if (request.transcript && (!transcript || transcript.source.projectId !== projectId)) throw Error('Select a valid transcript from this project');
  const media = await checkedMedia(projectId, scenes.assetId, scenes.sha256);
  if (media.type !== 'video' || media.sizeBytes !== scenes.sizeBytes || scenes.analysis.duration > (media.durationMs ?? 0) / 1000) throw Error('Analysis source no longer matches the original video');
  const plan = buildReferencePlan(request, { assetId: scenes.assetId, sha256: scenes.sha256 }, scenes.analysis, transcript ?? undefined);
  return { plan, warnings: [
    'This proposal contains machine-estimated cuts and speech, not semantic visual understanding. Review each source range and write your intended shot.',
    'No shot is accepted, recipe selected, caption invented, generation queued or timeline changed. Save your reviewed plan to continue.',
  ] };
}
