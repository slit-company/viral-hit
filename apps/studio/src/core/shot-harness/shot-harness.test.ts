import assert from 'node:assert/strict';
import test from 'node:test';

import { compileVideoPrompt } from './compile';
import { modelFamily } from './model-profiles';
import { prepareShot, shotPlan } from './plan';
import { rankModels, videoNeed } from './route';
import { shotSpec, type ShotModel, type ShotSpecInput } from './spec';

const refs = (min: number, max: number) => ({ image: { min, max }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 } });
const models: ShotModel[] = [
  { id: 'higgsfield-bytedance-seedance-2.5-image-to-video', name: 'Seedance 2.5 I2V', kind: 'video', studioTasks: ['video-generate'], referenceInputs: refs(1, 2), videoImageInputs: { frames: 2 },
    supportedDurations: ['4s', '5s', '6s', '8s'], supportedAspectRatios: ['auto'], controls: [{ key: 'resolution', type: 'select', choices: [{ value: '480p' }, { value: '720p' }, { value: '1080p' }] }, { key: 'generate_audio', type: 'boolean' }] },
  { id: 'higgsfield-bytedance-seedance-2.5-text-to-video', name: 'Seedance 2.5 T2V', kind: 'video', studioTasks: ['video-generate'], referenceInputs: refs(0, 0), supportedDurations: ['5s', '10s'], supportedAspectRatios: ['16:9', '9:16'] },
  { id: 'fal-minimax-h3-max-image-to-video', name: 'MiniMax H3', kind: 'video', studioTasks: ['video-generate'], referenceInputs: refs(0, 2), videoImageInputs: { frames: 2 }, supportedDurations: ['6s'], supportedAspectRatios: ['16:9'] },
  { id: 'runway-gen4', name: 'Runway', kind: 'video', studioTasks: ['video-generate'], referenceInputs: refs(1, 1), available: false },
  { id: 'higgsfield-soul-2', name: 'Soul 2', kind: 'image', studioTasks: ['image-generate'], referenceInputs: refs(0, 0), supportedAspectRatios: ['16:9', '1:1'] },
  { id: 'google-nano-banana-2.1', name: 'Nano Banana 2.1', kind: 'image', studioTasks: ['image-generate', 'image-edit'], referenceInputs: refs(0, 14), supportedAspectRatios: ['16:9'], controls: [{ key: 'resolution', type: 'select', choices: [{ value: '1K' }, { value: '2K' }] }] },
];
const base: ShotSpecInput = { subject: 'A courier in a lime rain jacket', action: 'sprints through the alley', setting: 'a neon alley at night', moves: ['dolly-in'], light: 'neon', duration: 5, aspectRatio: '16:9' };

test('a keyframe shot animates one still with the best image-to-video model', () => {
  const production = prepareShot(base, models);
  assert.equal(production.still?.model.id, 'higgsfield-soul-2');
  assert.equal(production.video.model.id, 'higgsfield-bytedance-seedance-2.5-image-to-video');
  assert.deepEqual(production.video.parameters, { aspect_ratio: 'auto', wmDuration: '5s', provider_options: { resolution: '1080p', generate_audio: false } });
  assert.match(production.still!.prompt, /Neon light/);
  // The still fixes the look, so the motion prompt leaves setting and light out.
  assert.doesNotMatch(production.video.prompt, /neon alley|neon light/);
  assert.match(production.video.prompt, /Camera: slow dolly in toward the subject/);
  const plan = shotPlan('project', production);
  assert.deepEqual(plan.nodes.map(item => item.id), ['still', 'take-1', 'take-2']);
  assert.deepEqual(plan.nodes[1].bindings, [{ node: 'still', pointer: '/assetId', target: '/references/0/assetId' }]);
});

test('characters steer the still toward a model that keeps identity, and unavailable models are skipped', () => {
  const production = prepareShot({ ...base, characterAssetIds: ['face'] }, models);
  assert.equal(production.still?.model.id, 'google-nano-banana-2.1');
  assert.deepEqual(production.still?.references, [{ assetId: 'face', kind: 'image', role: 'reference' }]);
  assert.match(production.still!.prompt, /Same person as the reference image/);
  assert.equal(rankModels(models, { ...videoNeed(shotSpec.parse(base)), images: 1 }).some(item => item.model.id === 'runway-gen4'), false);
});

test('text-to-video skips image-to-video models and snaps the duration up', () => {
  const production = prepareShot({ ...base, startFrame: 'none', duration: 7, variations: 1 }, models);
  assert.equal(production.still, null);
  assert.equal(production.video.model.id, 'higgsfield-bytedance-seedance-2.5-text-to-video');
  assert.equal(production.video.parameters.wmDuration, '10s');
  assert.match(production.notes.join(' '), /trim to 7s/);
  assert.match(production.video.prompt, /in a neon alley at night/);
  assert.deepEqual(shotPlan('project', production).nodes.map(item => [item.id, item.dependsOn]), [['take-1', undefined]]);
});

test('MiniMax receives its documented bracket camera commands and long prompts lose low-priority details first', () => {
  const spec = shotSpec.parse({ ...base, moves: ['orbit-left'], mood: 'tense '.repeat(30), startFrame: 'none' });
  const compiled = compileVideoPrompt(spec, modelFamily('minimax-h3', 'video'), { startFrame: false, characters: false, audio: false });
  assert.match(compiled.prompt, /^\[Truck left,Pan right\]/);
  const short = compileVideoPrompt(spec, { ...modelFamily('minimax-h3', 'video'), maxPromptChars: 200 }, { startFrame: false, characters: false, audio: false });
  assert.ok(short.prompt.length <= 200);
  assert.ok(short.dropped.some(text => text.startsWith('The mood is')));
  assert.match(short.prompt, /courier/);
});

test('a requested model must qualify for the step', () => {
  assert.throws(() => prepareShot({ ...base, videoModel: 'higgsfield-bytedance-seedance-2.5-text-to-video' }, models), /cannot run this video step/);
});


test('frame routing cannot substitute unordered references, and character references cannot become end frames', () => {
  const frame: ShotModel = { ...models[0], providerId: 'frames' };
  const reference: ShotModel = { ...models[0], id: 'seedance-reference-to-video', name: 'Seedance references', providerId: 'references', referenceInputs: refs(1, 4), videoImageInputs: { references: 4 } };
  const production = prepareShot({ ...base, startAssetId: 'start', endAssetId: 'end' }, [reference, frame]);
  assert.equal(production.video.model.providerId, 'frames');
  assert.deepEqual(production.video.references.map(ref => ref.assetId), ['start', 'end']);
  assert.equal(production.still, null);
  const direct = prepareShot({ ...base, startFrame: 'none', characterAssetIds: ['face', 'outfit'] }, [frame, reference]);
  assert.equal(direct.video.model.providerId, 'references');
  assert.throws(() => prepareShot({ ...base, startAssetId: 'start', endAssetId: 'end' }, [reference]), /No connected video/);
  assert.throws(() => shotSpec.parse({ ...base, startFrame: 'none', endAssetId: 'end' }), /start frame/);
  assert.throws(() => shotSpec.parse({ ...base, startAssetId: 'same', endAssetId: 'same' }), /different end frame/);
});

test('Comfy and direct-provider mode controls receive frames or references, while short Veo stays on 720p', () => {
  const model: ShotModel = { ...models[0], id: 'comfy-seedance-2.5', name: 'Seedance 2.5', referenceInputs: refs(0, 9),
    videoImageInputs: { frames: 2, references: 9 }, controls: [{ key: 'reference_mode', type: 'select', choices: [{ value: 'frames' }, { value: 'references' }] }] };
  assert.equal(prepareShot({ ...base, startAssetId: 'start' }, [model]).video.parameters.provider_options && (prepareShot({ ...base, startAssetId: 'start' }, [model]).video.parameters.provider_options as Record<string, unknown>).reference_mode, 'frames');
  const references = prepareShot({ ...base, startFrame: 'none', characterAssetIds: ['face', 'outfit', 'detail'] }, [model]);
  assert.equal((references.video.parameters.provider_options as Record<string, unknown>).reference_mode, 'references');
  const direct = { ...model, id: 'xai-grok-imagine-video-1.5', name: 'Grok', controls: [{ key: 'image_use', type: 'select', choices: [{ value: 'first-frame' }, { value: 'references' }] }] };
  assert.equal((prepareShot({ ...base, startFrame: 'none', characterAssetIds: ['face'] }, [direct]).video.parameters.provider_options as Record<string, unknown>).image_use, 'references');
  const veo: ShotModel = { ...models[0], id: 'comfy-veo-3.1', name: 'Veo 3.1', supportedDurations: ['4s', '6s', '8s'], controls: [{ key: 'resolution', type: 'select', choices: [{ value: '720p' }, { value: '1080p' }] }] };
  assert.equal((prepareShot({ ...base, startAssetId: 'start' }, [veo]).video.parameters.provider_options as Record<string, unknown>).resolution, '720p');
  assert.equal((prepareShot({ ...base, startAssetId: 'start', duration: 8 }, [veo]).video.parameters.provider_options as Record<string, unknown>).resolution, '1080p');
});

test('video/audio source requirements cannot be satisfied by an image-only shot', () => {
  const needsVideo: ShotModel = { ...models[0], id: 'video-edit', referenceInputs: { ...refs(1, 2), video: { min: 1, max: 1 } } };
  assert.throws(() => prepareShot({ ...base, startAssetId: 'start' }, [needsVideo]), /No connected video/);
});
