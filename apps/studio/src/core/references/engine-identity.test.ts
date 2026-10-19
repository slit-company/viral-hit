import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { youtubeEngineIdentity } from './engine-identity.server';
import { pinReferencePlan } from './recipe-plan.server';
import { createReferenceAdapter } from './recipe-adapters.server';

test('YouTube plans pin installed assemblies and reject mutated engines before invoking them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vh-engine-pin-'));
  const before = process.env.VIRAL_HIT_YOUTUBE_ENGINE;
  try {
    process.env.VIRAL_HIT_YOUTUBE_ENGINE = join(root, 'YoutubeIntake.dll');
    assert.equal(youtubeEngineIdentity(), null);
    for (const file of ['YoutubeIntake.dll', 'YoutubeExplode.dll', 'YoutubeIntake.deps.json', 'YoutubeIntake.runtimeconfig.json']) await writeFile(join(root, file), 'fixture bytes');
    const engine = youtubeEngineIdentity(); assert.match(engine!, /^[a-f0-9]{64}$/);
    const plan = await pinReferencePlan({ projectId: 'p', nodes: [{ id: 'ref', operation: 'reference.youtube', version: '1', input: { videoId: 'u_yIGGhubZs', height: 720 } }] });
    assert.equal((plan.nodes[0].input as { engine: string }).engine, engine);
    await writeFile(join(root, 'YoutubeExplode.dll'), 'changed dependency');
    assert.notEqual(youtubeEngineIdentity(), engine);
    await assert.rejects(createReferenceAdapter('reference.youtube').submit(plan.nodes[0].input, {
      key: 'pinned', projectId: 'p', dependencies: {}, signal: AbortSignal.timeout(1000),
    }), /engine changed/);
    await assert.rejects(pinReferencePlan(plan), /matching YoutubeExplode/);
  } finally {
    if (before === undefined) delete process.env.VIRAL_HIT_YOUTUBE_ENGINE; else process.env.VIRAL_HIT_YOUTUBE_ENGINE = before;
    await rm(root, { recursive: true, force: true });
  }
});
