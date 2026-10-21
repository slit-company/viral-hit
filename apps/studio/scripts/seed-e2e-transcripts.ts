// Uses the explicit protocol fixture from start-e2e, not a real speech model.
import { createProject } from '../src/core/projects/projects';
import { importLocalProjectAsset } from '../src/core/projects/import-local-asset';
import { prepareRecipePlan } from '../src/core/harness/recipe-plan';
import { pinRuntimePlan } from '../src/core/harness/runtime-plan';
import { openHarness } from '../src/core/harness/store';
import { createRuntimeAdapters } from '../src/core/harness/adapters';
export async function seedTranscript(file: string) {
  const project = await createProject({ name: 'Transcript E2E fixture' });
  const asset = await importLocalProjectAsset({ projectId: project.id, filePath: file });
  const h = openHarness();
  try {
    const plan = await pinRuntimePlan(await prepareRecipePlan('local-transcription-video-captions', { source: asset.id }, project.id));
    const run = h.enqueue(plan, 'transcript-fixture');
    for (let i = 0; i < 5; i++) await h.step(run, createRuntimeAdapters());
    if (h.jobs(run).some(job => job.state !== 'succeeded')) throw Error('Transcript fixture failed: ' + h.jobs(run).map(job => job.error).join(', '));
  } finally { h.close(); }
  return project;
}
