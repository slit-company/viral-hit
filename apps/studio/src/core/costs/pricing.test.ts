import test from 'node:test';
import assert from 'node:assert/strict';
import { costRequest, estimateCost, modelPricingSchema, sumCosts, unitRate } from './pricing';

const source = 'https://example.com/pricing', checked = '2026-11-03';

test('per-second prices follow the chosen option and the minimum charge', () => {
  const pricing = modelPricingSchema.parse({ currency: 'USD', per: 'second', amount: 0.3, by: { option: 'resolution', amounts: { '480p': 0.2, '1080p': 0.68 } }, minimum: 0.8, source, checked });
  assert.deepEqual(estimateCost(pricing, costRequest({ duration: '5s', options: { resolution: '1080p' } })), { amount: 3.4, currency: 'USD', basis: 'list' });
  assert.equal(estimateCost(pricing, costRequest({ duration: '5s', options: { resolution: '720p' } }))?.amount, 1.5);
  assert.equal(estimateCost(pricing, costRequest({ duration: '2s', options: { resolution: '480p' } }))?.amount, 0.8);
  assert.equal(estimateCost(pricing, costRequest({ defaultDuration: '6s', options: {} }))?.amount, 1.8);
  assert.equal(estimateCost(pricing, costRequest({})), null);
  assert.deepEqual(unitRate(pricing, { resolution: '480p' }), { amount: 0.2, currency: 'USD', basis: 'list' });
});

test('rates can depend on two options together', () => {
  const pricing = modelPricingSchema.parse({ currency: 'USD', per: 'second', by: { option: ['resolution', 'generate_audio'], amounts: { '720p|false': 0.2, '720p|true': 0.4 } }, source, checked });
  assert.equal(estimateCost(pricing, costRequest({ duration: '8s', options: { resolution: '720p', generate_audio: true } }))?.amount, 3.2);
  assert.equal(estimateCost(pricing, costRequest({ duration: '8s', options: { resolution: '720p', generate_audio: false } }))?.amount, 1.6);
  assert.equal(estimateCost(pricing, costRequest({ duration: '8s', options: { resolution: '4k', generate_audio: false } })), null);
  assert.equal(estimateCost(pricing, costRequest({ duration: '8s', options: { resolution: '720p' } })), null);
});

test('an option value without a listed rate stays unpriced when there is no fallback', () => {
  const pricing = modelPricingSchema.parse({ currency: 'characters', per: 'character', by: { option: 'model_id', amounts: { eleven_v4: 1, eleven_flash_v2_5: 0.5 } }, source, checked });
  assert.equal(estimateCost(pricing, costRequest({ prompt: 'Did you see that?', options: { model_id: 'eleven_v4' } }))?.amount, 17);
  assert.equal(estimateCost(pricing, costRequest({ prompt: 'Did you see that?', options: { model_id: 'eleven_flash_v2_5' } }))?.amount, 9);
  assert.equal(estimateCost(pricing, costRequest({ prompt: 'Did you see that?', options: { model_id: 'eleven_v4_turbo' } })), null);
  assert.throws(() => modelPricingSchema.parse({ currency: 'USD', per: 'request', source, checked }));
  assert.throws(() => modelPricingSchema.parse({ currency: 'credits', per: 'request', amount: 5, source, checked }));
});

test('totals add per currency, keep the weaker basis and count unpriced steps', () => {
  const image = modelPricingSchema.parse({ currency: 'USD', per: 'megapixel', amount: 0.048, source, checked });
  const average = modelPricingSchema.parse({ currency: 'USD', per: 'request', amount: 0.0815, basis: 'average', source, checked });
  const first = estimateCost(image, costRequest({ options: { resolution: '2k' } }));
  assert.equal(first?.amount, 0.2011);
  const total = sumCosts([{ amount: 64, currency: 'characters', basis: 'list' }, first, estimateCost(average, costRequest({})), null]);
  assert.deepEqual(total, { totals: [{ amount: 0.2826, currency: 'USD', basis: 'average' }, { amount: 64, currency: 'characters', basis: 'list' }], unpriced: 1 });
});
