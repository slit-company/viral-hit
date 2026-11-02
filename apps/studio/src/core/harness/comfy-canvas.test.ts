import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canvasToApi, CanvasConversionError, isCanvasWorkflow, type CanvasWorkflow, type ComfyDefinitions } from './comfy-canvas';

const fixture = <T>(name: string) => JSON.parse(readFileSync(new URL('./fixtures/comfy/' + name, import.meta.url), 'utf8')) as T;
// Node definitions captured from Comfy Cloud's /api/object_info, trimmed to the classes these workflows use.
const definitions = fixture<ComfyDefinitions>('cloud-definitions.json');
const minimax = fixture<CanvasWorkflow>('canvas-minimax-h3-background-swap.json');
const qwen = fixture<CanvasWorkflow>('canvas-qwen-image-edit.json');

test('a canvas workflow with a subgraph, reroutes and muted nodes becomes the API graph ComfyUI runs', () => {
  assert.equal(isCanvasWorkflow(minimax), true);
  const { graph, outputs, warnings } = canvasToApi(minimax, definitions);
  assert.deepEqual(outputs, ['92']);
  assert.equal(Object.keys(graph).length, 33);
  assert.ok(Object.values(graph).every((node) => !['Reroute', 'MarkdownNote'].includes(node.class_type)), 'canvas-only nodes are gone');
  assert.ok(!graph['170'] && !graph['171'] && !graph['169'], 'muted nodes, and nodes only they used, are left out');
  // Subgraph nodes get execution IDs under their parent, and reroutes resolve to the real source.
  const h3 = graph['141:136'].inputs;
  assert.equal(graph['141:136'].class_type, 'MiniMaxH3ReferenceToVideo');
  assert.deepEqual([h3['ref_images.ref_image_0'], h3['ref_images.ref_image_2'], h3['ref_videos.ref_video_0']], [['137', 0], ['137', 0], ['160', 0]]);
  assert.equal(h3['ref_images.ref_image_3'], undefined, 'unconnected autogrow slots stay out');
  assert.deepEqual([h3.width, h3.height, h3.length, h3.ref_image_size], [['141:115', 0], ['141:115', 1], ['141:131', 1], 'max']);
  // Widget values map to names by the server's definitions, skipping control_after_generate values.
  assert.deepEqual(graph['141:127'].inputs, { unet_name: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', weight_dtype: 'default' });
  assert.deepEqual(graph['141:128'].inputs, { clip_name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', type: 'minimax', device: 'default' });
  assert.deepEqual(graph['141:179'].inputs, { model: ['141:127', 0], shift_video: 12, shift_audio: 6 });
  assert.deepEqual(graph['161'].inputs, { value: 157368968253448 });
  // A subgraph input linked outside follows the link; one left as a widget passes its value in.
  assert.deepEqual(graph['141:129'].inputs, { noise_seed: ['161', 0] });
  assert.equal(graph['141:165'].inputs.find, '[SWAP_INSTRUCTION]');
  assert.match(String(graph['141:165'].inputs.replace), /^Replace only the distant background/);
  assert.deepEqual(graph['141:184'].inputs, { switch: ['180', 0], on_false: ['141:179', 0], on_true: ['141:187', 0] });
  // V3 dynamic combos serialize their chosen option's inputs under dotted names.
  assert.deepEqual({ ...graph['92'].inputs, filename_prefix: undefined }, { video: ['164', 0], filename_prefix: undefined, format: 'auto', 'format.codec': 'auto' });
  assert.deepEqual(graph['160'].inputs.video, 'example.mp4');
  assert.deepEqual(warnings, ['VHS_LoadVideo 160: "example.mp4" is not available on this server for video']);
});

test('nested dynamic options, subgraph literals and missing model files are reported against the target server', () => {
  const { graph, outputs, warnings } = canvasToApi(qwen, definitions);
  assert.deepEqual(outputs.sort(), ['461', '472']);
  assert.deepEqual(graph['461'].inputs, { images: ['459:457', 0], filename_prefix: 'Qwen_image_2.1', format: 'png', 'format.bit_depth': '8-bit', 'format.input_color_space': 'sRGB' });
  assert.deepEqual(graph['459:458'].inputs, { model: ['459:469', 0], seed: 90946806439488, steps: 10, cfg: 1, sampler_name: 'euler', scheduler: 'simple', positive: ['459:474', 0], negative: ['459:474', 1], latent_image: ['459:468', 0], denoise: 1 });
  assert.deepEqual(graph['459:474'].inputs['images.image_1'], ['477', 0]);
  assert.deepEqual(warnings, [
    'UNETLoader 459:451: "qwen_image_2.1_bf16.safetensors" is not available on this server for unet_name',
    'VAELoader 459:454: "qwen_image_2.1_vae_bf16.safetensors" is not available on this server for vae_name',
  ]);
});

test('bypassed nodes pass their input through, and unknown nodes or a missing output are refused', () => {
  const tiny = (mode: number, saveType = 'SaveImageAdvanced'): CanvasWorkflow => ({
    nodes: [
      { id: 1, type: 'LoadImage', widgets_values: ['photo.png', 'image'] },
      { id: 2, type: 'ImageScale', mode, inputs: [{ name: 'image', type: 'IMAGE', link: 10 }], widgets_values: ['lanczos', 512, 512, 'disabled'] },
      { id: 3, type: saveType, inputs: [{ name: 'images', type: 'IMAGE', link: 11 }], widgets_values: ['out', 'png', '8-bit', 'sRGB'] },
    ],
    links: [[10, 1, 0, 2, 0, 'IMAGE'], [11, 2, 0, 3, 0, 'IMAGE']],
  });
  assert.deepEqual(canvasToApi(tiny(4), definitions).graph['3'].inputs.images, ['1', 0]);
  assert.equal(canvasToApi(tiny(4), definitions).graph['2'], undefined);
  assert.deepEqual(canvasToApi(tiny(0), definitions).graph['2'].inputs, { image: ['1', 0], upscale_method: 'lanczos', width: 512, height: 512, crop: 'disabled' });
  assert.throws(() => canvasToApi(tiny(0, 'SaveAnimatedPNG'), definitions), (error) => error instanceof CanvasConversionError && error.missingNodes.join() === 'SaveAnimatedPNG');
  assert.throws(() => canvasToApi({ nodes: [{ id: 1, type: 'LoadImage', widgets_values: ['photo.png', 'image'] }], links: [] }, definitions), /no output node/);
  assert.equal(isCanvasWorkflow({ '1': { class_type: 'LoadImage', inputs: {} } }), false);
});
