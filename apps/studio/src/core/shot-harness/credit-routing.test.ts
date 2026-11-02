import assert from 'node:assert/strict';
import test from 'node:test';
import { serviceCredit, serviceHealth } from '../generation-providers/service-credit';
import { prepareShot } from './plan';
import { pickModel, videoNeed } from './route';
import { shotSpec, type ShotModel } from './spec';

const refs = (min: number, max: number) => ({ image: { min, max }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 } });
const video = (id: string, providerId: string, credit?: ShotModel['credit']): ShotModel => ({
  id, name: id, providerId, providerLabel: providerId.toUpperCase(), kind: 'video', studioTasks: ['video-generate'], referenceInputs: refs(1, 2), videoImageInputs: { frames: 2 },
  supportedDurations: ['5s'], supportedAspectRatios: ['16:9'], ...(credit ? { credit } : {}),
});
const empty = (source: 'balance' | 'history') => ({ state: 'empty' as const, source, reason: source === 'balance' ? 'no credits left (0 USD)' : 'ran out of credit on its last run' });
const spec = shotSpec.parse({ subject: 'A cyclist', startAssetId: 'start', duration: 5, aspectRatio: '16:9' });

test('auto routing skips services that are out of credit and says so in the plan', () => {
  const models = [video('fal-seedance-2.5-image-to-video', 'fal', empty('balance')), video('runway-seedance-2.0-image-to-video', 'runway')];
  const picked = pickModel(models, videoNeed(spec), 'auto');
  assert.equal(picked.chosen.model.providerId, 'runway', 'the stronger family is skipped because fal reported zero');
  assert.deepEqual(picked.skipped.map(item => item.model.providerId), ['fal']);
  const production = prepareShot({ ...spec, startAssetId: 'start' }, models);
  assert.ok(production.notes.includes('Skipped FAL: no credits left (0 USD)'), production.notes.join(' | '));
});

test('a chosen model is refused only when its service reported zero; a failed run alone does not block a retry', () => {
  const models = [video('fal-a', 'fal', empty('balance')), video('higgsfield-b', 'higgsfield', empty('history')), video('xai-c', 'xai')];
  assert.throws(() => pickModel(models, videoNeed(spec), 'fal-a'), /FAL has no credits left \(0 USD\)/);
  assert.equal(pickModel(models, videoNeed(spec), 'higgsfield-b').chosen.model.id, 'higgsfield-b');
  assert.throws(() => pickModel(models.slice(0, 2), videoNeed(spec), 'auto'), /Every service that can run this video step is out of credit: FAL \(no credits left \(0 USD\)\), HIGGSFIELD \(ran out of credit on its last run\)\. Add credits/);
});

test('a reported balance outranks run history, and adding credits forgets earlier failures', () => {
  const failure = { modelId: 'hf', providerId: 'higgsfield', succeeded: false, error: 'Not enough credits', at: 100 };
  assert.equal(serviceHealth([failure]).get('higgsfield')?.outOfCredit, true);
  assert.equal(serviceHealth([failure], new Map([['higgsfield', 200]])).get('higgsfield'), undefined);
  assert.deepEqual(serviceCredit({ state: 'available', amount: 12.5, unit: 'USD' }, serviceHealth([failure]).get('higgsfield')), { state: 'available', source: 'balance', reason: '12.5 USD left' });
  assert.deepEqual(serviceCredit({ state: 'unknown' }, serviceHealth([failure]).get('higgsfield')), { state: 'empty', source: 'history', reason: 'ran out of credit on its last run' });
  assert.equal(serviceCredit(undefined, undefined), undefined);
});
