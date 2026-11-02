import assert from 'node:assert/strict';
import test from 'node:test';
import { providerManifestSchema } from './installed/manifest';

const refs = { image: { min: 0, max: 2 }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 } };
const video = { id: 'test-video', name: 'Video', kind: 'video', aspectRatios: ['16:9'], referenceInputs: refs };
const manifest = (model: unknown) => ({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'example', label: 'Example', models: [model] });

test('video image modes are explicit, bounded and compatible with the declared image count', () => {
  const parsed = providerManifestSchema.parse(manifest({ ...video, videoImageInputs: { frames: 2, references: 2 } }));
  assert.deepEqual(parsed.models[0].videoImageInputs, { frames: 2, references: 2 });
  for (const videoImageInputs of [{}, { frames: 3 }, { references: 3 }, { frames: 0 }]) {
    assert.equal(providerManifestSchema.safeParse(manifest({ ...video, videoImageInputs })).success, false);
  }
  assert.equal(providerManifestSchema.safeParse(manifest({ ...video, kind: 'image', videoImageInputs: { frames: 1 } })).success, false);
  assert.equal(providerManifestSchema.safeParse(manifest(video)).success, true, 'legacy providers still load without a frame claim');
});
