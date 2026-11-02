import assert from 'node:assert/strict';
import test from 'node:test';
import { describeVideoImages } from '../src/kit/video-image-inputs.mjs';
import higgsfield from '../src/providers/higgsfield/catalog.json' with { type: 'json' };
import fal from '../src/providers/fal/catalog.json' with { type: 'json' };
import runway from '../src/providers/runway/catalog.json' with { type: 'json' };

test('video modes follow native binding fields, and mixed endpoints do not claim reference-only delivery', () => {
  const modes = (catalog, endpoint) => describeVideoImages(catalog.models.find(entry => entry.model.upstreamModelId === endpoint)).videoImageInputs;
  assert.deepEqual(modes(higgsfield, 'bytedance/seedance-2.5/image-to-video'), { frames: 2 });
  assert.deepEqual(modes(higgsfield, 'bytedance/seedance-2.5/reference-to-video'), { references: 14 });
  assert.deepEqual(modes(fal, 'bytedance/seedance-2.5/us/image-to-video'), { frames: 2 });
  assert.deepEqual(modes(runway, 'image_to_video/veo3.1'), { frames: 2 });
  assert.deepEqual(modes(runway, 'text_to_video/seedance2_5'), { references: 14 });
  assert.deepEqual(modes(higgsfield, 'kling-video/o3/image-reference'), { frames: 2 });
});
