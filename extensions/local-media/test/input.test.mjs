import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDocument, checkSong, checkTimeline, checkValidation } from '../src/input.mjs';
const song = JSON.parse(await readFile(new URL('../examples/pulse.song.json', import.meta.url)));
const timeline = JSON.parse(await readFile(new URL('../examples/title.timeline.json', import.meta.url)));

test('accepts authored synthesis and procedural motion without fixed template assumptions', () => {
  const custom = structuredClone(song); custom.bpm = 137; custom.tracks[2].pattern = 'g4 [a4 b4] d5 ~';
  assert.equal(checkSong(custom), custom);
  const motion = structuredClone(timeline); motion.output.width = 360; motion.output.height = 640;
  assert.equal(checkTimeline(motion), motion);
});
test('rejects external music files, sampled instruments and plugins in nested layers', () => {
  for (const key of ['audioTracks', 'plugins']) {
    const input = structuredClone(song); input[key] = [];
    assert.throws(() => checkSong(input), /External/);
  }
  for (const instrument of ['sfz:/secret.sfz', 'kit:../../secret', 'user:drums', 'lib:piano']) {
    const input = structuredClone(song); input.tracks[0].layers = [{ id: 'layer', instrument }];
    assert.throws(() => checkSong(input), /synthesized/);
  }
});
test('rejects provider/file paths before any upstream video validation can read them', () => {
  const cases = [
    { sources: { ref: { type: 'generate', provider: 'ima2', prompt: 'paid' } } },
    { beat: { map: '/secret' } }, { fonts: { custom: { path: '/secret' } } },
    { effects: [{ type: 'grade', lut: '/secret' }] },
    { audio: { voice: [{ tts: { text: 'paid' } }] } },
    { audio: { music: { provider: 'external' } } },
    { audio: { cues: [{ at: 0, sfx: 'elevenlabs:paid' }] } },
  ];
  for (const item of cases) assert.throws(() => checkTimeline({ ...timeline, ...item }));
});
test('bounds document size/depth, resolved duration/events and video pixel work', () => {
  assert.throws(() => parseDocument(' '.repeat(16001)), /16,000/);
  assert.throws(() => parseDocument('{"__proto__":{}}'), /key/);
  assert.throws(() => parseDocument('{"a":'.repeat(26) + '0' + '}'.repeat(26)), /complexity/);
  const long = structuredClone(song); long.arrangement[0].repeats = 32;
  assert.throws(() => checkSong(long), /duration/);
  assert.throws(() => checkTimeline({ ...timeline, output: { width: 1920, height: 1920 } }), /pixel/);
  assert.throws(() => checkTimeline({ ...timeline, output: { fps: '30000/1001' } }), /FPS/);
  assert.throws(() => checkValidation('video', { data: { summary: { totalSeconds: 61 } } }, timeline), /duration/);
  assert.throws(() => checkValidation('music', { data: { durationSeconds: 4, tracks: [{ events: 10001 }] } }, song), /events/);
  assert.doesNotThrow(() => checkValidation('music', { data: { durationSeconds: 4, tracks: [{ events: 16 }] } }, song));
});
