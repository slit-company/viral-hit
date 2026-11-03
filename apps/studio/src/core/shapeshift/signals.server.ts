import { checkFaceMatch } from '../characters/face-match.server';
import type { openHarness } from '../harness/store';

type Harness = ReturnType<typeof openHarness>;
/** A key or account that may not call a model's route; another try would be refused the same way. */
const REFUSED = /route_not_allowed|not allowed|forbidden|permission|\(40[13]\b/i;
const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Models whose latest run in the last week was refused for this account, so automatic choices try them last. */
export function refusedModels(h: Harness, now = Date.now()) {
  const rows = h.db.prepare("SELECT j.input_json, j.state, j.error FROM vh_jobs j JOIN vh_runs r ON r.id=j.run_id WHERE j.operation='generation.model' AND r.created_at>=? ORDER BY r.created_at DESC LIMIT 500")
    .all(now - WEEK) as Array<{ input_json: string; state: string; error: string | null }>;
  const latest = new Map<string, boolean>();
  for (const row of rows) {
    let modelId = '';
    try { modelId = String((JSON.parse(row.input_json) as { modelId?: unknown }).modelId ?? ''); } catch { continue; }
    if (modelId && !latest.has(modelId) && row.state !== 'queued' && row.state !== 'running') latest.set(modelId, row.state !== 'succeeded' && REFUSED.test(row.error ?? ''));
  }
  return new Set([...latest].filter(([, refused]) => refused).map(([modelId]) => modelId));
}

const faces = new Map<string, boolean>();
/** Whether the main subject picture shows a detectable face (local OpenCV); remembered per picture. */
export async function subjectHasFace(projectId: string, assetId: string | undefined) {
  if (!assetId) return false;
  const key = projectId + '/' + assetId;
  if (!faces.has(key)) {
    if (faces.size >= 256) faces.delete(faces.keys().next().value!);
    faces.set(key, await checkFaceMatch(projectId, { assetIds: [assetId], referenceAssetIds: [assetId] }).then(report => report.referenceFaces > 0, () => false));
  }
  return faces.get(key)!;
}
