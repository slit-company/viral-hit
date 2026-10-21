// Isolated E2E fixture: real visual cuts and audio processed through the normal worker adapters.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { getViralHitDataRoot } from '../src/config/data-root';
import { createProject } from '../src/core/projects/projects';
import { importLocalProjectAsset } from '../src/core/projects/import-local-asset';
import { prepareRecipePlan } from '../src/core/harness/recipe-plan';
import { pinRuntimePlan } from '../src/core/harness/runtime-plan';
import { createRuntimeAdapters } from '../src/core/harness/adapters';
import { openHarness } from '../src/core/harness/store';

export async function seedScenes() {
  const file = join(getViralHitDataRoot(), 'scene-cuts.mp4');
  execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=128x72:d=1:r=24', '-f', 'lavfi', '-i', 'color=blue:s=128x72:d=1:r=24', '-f', 'lavfi', '-i', 'color=green:s=128x72:d=1:r=24', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
  const project = await createProject({ name: 'Detected scenes E2E fixture' });
  const asset = await importLocalProjectAsset({ projectId: project.id, filePath: file });
  const plan = await pinRuntimePlan(await prepareRecipePlan('detect-video-scenes', { source: asset.id }, project.id));
  const h = openHarness();
  try {
    const run = h.enqueue(plan, 'scene-browser-fixture');
    for (let i = 0; i < 5; i++) await h.step(run, createRuntimeAdapters());
    if (h.jobs(run).some(job => job.state !== 'succeeded')) throw Error('Scene fixture failed: ' + h.jobs(run).map(job => job.error).join(', '));
  } finally { h.close(); }
  return project;
}
