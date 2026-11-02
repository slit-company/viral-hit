import test from 'node:test';
import assert from 'node:assert/strict';
import * as falProvider from '../src/providers/fal/provider.mjs';
import * as runwayProvider from '../src/providers/runway/provider.mjs';
import * as elevenlabsProvider from '../src/providers/elevenlabs/provider.mjs';
import * as higgsfieldProvider from '../src/providers/higgsfield/provider.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function serve(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const key = (init.method ?? 'GET') + ' ' + url;
    calls.push({ key, init });
    const route = Object.entries(routes).find(([pattern]) => key.startsWith(pattern));
    return route ? route[1] : json({ detail: 'no route ' + key }, 404);
  };
  return calls;
}

test('fal reads the credit balance with the key, and a key without billing access is unknown, not empty', async () => {
  const calls = serve({ 'GET https://api.fal.ai/v1/account/billing?expand=credits': json({ username: 'studio', credits: { current_balance: 12.5, currency: 'USD' } }) });
  assert.deepEqual(await falProvider.checkBalance({ configuration: { FAL_KEY: 'key-id:key-secret-value' } }), { state: 'known', amount: 12.5, unit: 'USD' });
  assert.equal(calls[0].init.headers.Authorization, 'Key key-id:key-secret-value');
  serve({ 'GET https://api.fal.ai/v1/account/billing': json({ detail: 'Forbidden' }, 403) });
  const denied = await falProvider.checkBalance({ configuration: { FAL_KEY: 'key-id:key-secret-value' } });
  assert.equal(denied.state, 'unknown');
  assert.match(denied.reason, /billing/);
  serve({ 'GET https://api.fal.ai/v1/account/billing': json({ detail: 'down' }, 503) });
  await assert.rejects(falProvider.checkBalance({ configuration: { FAL_KEY: 'key-id:key-secret-value' } }), /HTTP 503/);
});

test('Runway reports organization credits; ElevenLabs reports remaining characters; Higgsfield has no balance API', async () => {
  const calls = serve({ 'GET https://api.dev.runwayml.com/v1/organization': json({ creditBalance: 0, tier: { maxMonthlyCreditSpend: 1000 }, usage: {} }) });
  assert.deepEqual(await runwayProvider.checkBalance({ configuration: { RUNWAYML_API_SECRET: 'key_abcdefghijklmnop' } }), { state: 'known', amount: 0, unit: 'credits' });
  assert.equal(calls[0].init.headers['X-Runway-Version'], '2024-11-06');
  serve({ 'GET https://api.elevenlabs.io/v1/user/subscription': json({ character_count: 9000, character_limit: 10000 }) });
  assert.deepEqual(await elevenlabsProvider.checkBalance({ configuration: { ELEVENLABS_API_KEY: 'sk_test_value_for_fixture_only' } }), { state: 'known', amount: 1000, unit: 'characters' });
  assert.equal(higgsfieldProvider.checkBalance, undefined, 'no public balance API, so routing learns from failed runs');
  for (const provider of [falProvider, runwayProvider, elevenlabsProvider]) assert.equal(provider.manifest.balanceCheck, true);
  assert.equal(higgsfieldProvider.manifest.balanceCheck, undefined);
});

test('ElevenLabs speech returns the audio and word timing from character timestamps', async () => {
  const text = 'Find the hit.';
  const characters = [...text];
  const starts = characters.map((_, index) => index * 0.1), ends = characters.map((_, index) => index * 0.1 + 0.08);
  const calls = serve({ 'POST https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/with-timestamps?output_format=mp3_44100_128': json({ audio_base64: Buffer.from('ID3fake-mp3').toString('base64'), alignment: { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } }) });
  const result = await elevenlabsProvider.createGeneration({ model: { id: 'elevenlabs-speech', kind: 'audio' }, input: { prompt: text }, configuration: { ELEVENLABS_API_KEY: 'sk_test_value_for_fixture_only' } });
  assert.equal(result.media[0].mimeType, 'audio/mpeg');
  assert.equal(Buffer.from(result.media[0].data).toString(), 'ID3fake-mp3');
  assert.deepEqual(result.speechWords, [{ text: 'Find', start: 0, end: 0.38 }, { text: 'the', start: 0.5, end: 0.78 }, { text: 'hit.', start: 0.9, end: 1.28 }]);
  assert.equal(JSON.parse(calls[0].init.body).text, text);
  assert.deepEqual(elevenlabsProvider.wordsFromAlignment({ characters: ['a'], character_start_times_seconds: [], character_end_times_seconds: [] }), []);
});
