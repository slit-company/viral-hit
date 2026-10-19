// Test-only fixture creation. Never used by the normal server or worker entry points.
import { copyFile } from 'node:fs/promises';
import { createProject } from '../src/core/projects/projects';
import { openHarness } from '../src/core/harness/store';
import { createMaterializeAdapter } from '../src/core/harness/materialize';
import { probeMedia } from '../src/core/harness/probe-media';
const project = await createProject({ name: 'Materialized media E2E fixture' });
const h = openHarness();
try {
  const adapter = createMaterializeAdapter({ download: async (_url, destination) => { await copyFile('public/logo.png', destination); }, probe: probeMedia });
  const run = h.enqueue({ projectId: project.id, nodes: [{ id: 'imported-image', operation: 'asset.materialize', version: 'fixture', input: { url: 'https://example.invalid/test-fixture.png', kind: 'image', label: 'Imported E2E fixture' } }] }, 'fixture');
  await h.step(run, { 'asset.materialize': adapter }); await h.step(run, { 'asset.materialize': adapter });
  if (h.jobs(run)[0].state !== 'succeeded') throw new Error('Could not create materialized media fixture');
} finally { h.close(); }
