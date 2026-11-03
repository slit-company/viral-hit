import test from 'node:test';
import assert from 'node:assert/strict';
import type { ShotModel } from '../shot-harness/spec';
import { closestAspect, longestPiece, pickShapeshiftModel, rankShapeshiftModels, shapeshiftParameters, spreadModels } from './routing';

const range = (min: number, max: number) => ({ min, max });
const model = (id: string, providerId: string, extra: Partial<ShotModel> = {}): ShotModel => ({
  id, name: id, providerId, providerLabel: providerId, kind: 'video', studioTasks: ['video-generate'],
  referenceInputs: { image: range(0, 9), video: range(0, 3), audio: range(0, 0) }, supportedDurations: ['5s', '10s'], ...extra,
});
const funded = { state: 'available' as const, source: 'balance' as const, reason: '16 USD left' };
const empty = { state: 'empty' as const, source: 'balance' as const, reason: 'no credits left (0 credits)' };
const catalog = [
  model('fal-wan-animate-replace', 'fal', { studioTasks: ['object-swap'] }),
  model('fal-kling-motion-control', 'fal', { studioTasks: ['motion-control'] }),
  model('sume-seedance-2.5', 'sume', { credit: funded }),
  model('sume-minimax-h3', 'sume', { credit: funded }),
  model('sume-motion-control', 'sume', { studioTasks: ['motion-control'], credit: funded }),
  model('runway-act-two', 'runway', { studioTasks: ['motion-transfer'], credit: empty }),
  model('text-only', 'sume', { referenceInputs: { image: range(0, 9), video: range(0, 0), audio: range(0, 0) }, credit: funded }),
  model('sume-higgsfield-genjutsu', 'sume', { studioTasks: ['motion-transfer'], credit: funded }),
];

test('funded services come first, then the mode’s model families; empty services are skipped', () => {
  const motion = rankShapeshiftModels(catalog, 'motion-transfer');
  assert.deepEqual(motion.ranked.map(item => item.id), ['sume-motion-control', 'sume-seedance-2.5', 'sume-minimax-h3', 'fal-kling-motion-control']);
  assert.deepEqual(motion.skipped.map(item => item.id), ['runway-act-two']);
  // A replacement model is the first choice for object swap, but only funded services are tried before it.
  assert.deepEqual(rankShapeshiftModels(catalog, 'object-swap').ranked.map(item => item.id), ['sume-seedance-2.5', 'sume-minimax-h3', 'fal-wan-animate-replace']);
});

test('variations use a different model family each, funded ones first, and repeat when there are fewer', () => {
  const { ranked } = rankShapeshiftModels(catalog, 'motion-transfer');
  assert.deepEqual(spreadModels(ranked, 'motion-transfer', 3).map(item => item.id), ['sume-motion-control', 'sume-seedance-2.5', 'sume-minimax-h3']);
  assert.deepEqual(spreadModels(ranked.slice(0, 1), 'motion-transfer', 2).map(item => item.id), ['sume-motion-control', 'sume-motion-control']);
});

test('a chosen model must be able to do the job and have credit', () => {
  assert.equal(pickShapeshiftModel(catalog, 'object-swap', 'auto').chosen.id, 'sume-seedance-2.5');
  assert.throws(() => pickShapeshiftModel(catalog, 'motion-transfer', 'text-only'), /cannot rebuild a video/);
  assert.throws(() => pickShapeshiftModel(catalog, 'motion-transfer', 'runway-act-two'), /runway has no credits left/);
  assert.throws(() => pickShapeshiftModel([catalog[5]], 'motion-transfer', 'auto'), /out of credit: runway/);
  assert.throws(() => pickShapeshiftModel([], 'object-swap', 'auto'), /Connect fal, Runway, Comfy or Sume/);
});

test('pieces follow what each model makes in one go, at most 15 seconds', () => {
  assert.equal(longestPiece(model('a', 'x')), 10);
  assert.equal(longestPiece(model('b', 'x', { supportedDurations: ['4s', '30s'] })), 15);
  assert.equal(longestPiece(model('c', 'x', { supportedDurations: undefined, studioTasks: ['video-edit'] })), 15);
  assert.equal(longestPiece(model('d', 'x', { supportedDurations: undefined, controls: [{ key: 'source_seconds', type: 'number', max: 8 } as never] })), 8);
});

test('settings follow the source: nearest shape, requested quality or the next one down, source length and orientation', () => {
  assert.equal(closestAspect(['1:1', '16:9', '9:16'], 1080, 1920), '9:16');
  assert.equal(closestAspect(['auto', '16:9'], 1080, 1920), 'auto');
  const controls = [
    { key: 'resolution', type: 'select', choices: [{ value: '480p' }, { value: '768p' }, { value: '2K' }] },
    { key: 'source_seconds', type: 'number' }, { key: 'orientation', type: 'select', choices: [{ value: 'video' }, { value: 'image' }] },
    { key: 'keep_sound', type: 'boolean', default: true },
  ];
  assert.deepEqual(shapeshiftParameters(model('m', 'x', { controls }), 'motion-transfer', '720p', 6.04, 1920, 1080),
    { wmDuration: '10s', provider_options: { resolution: '480p', source_seconds: 7, orientation: 'video', keep_sound: false } });
});
