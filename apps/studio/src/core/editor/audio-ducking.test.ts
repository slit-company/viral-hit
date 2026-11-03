import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DEFAULT_DUCKING, duckingExpression, duckingGain, voiceIntervals } from './audio-ducking';

const clip = (startTime: number, duration: number, audioRole: string, extra = {}) => ({ startTime, duration, audioRole, muted: false, volume: 1, ...extra });
const doc = (clips: ReturnType<typeof clip>[], muted = false) => ({ tracks: [{ kind: 'audio', muted, clips }] });

test('voice spans merge when the music would not have time to come back', () => {
  assert.deepEqual(voiceIntervals(doc([clip(6, 1, 'voice'), clip(1, 2, 'voice'), clip(3.5, 1, 'voice'), clip(0, 9, 'music')])), [[1, 4.5], [6, 7]]);
  assert.deepEqual(voiceIntervals(doc([clip(1, 2, 'voice', { muted: true }), clip(4, 1, 'voice', { volume: 0 })])), []);
  assert.deepEqual(voiceIntervals(doc([clip(1, 2, 'voice')], true)), []);
});

test('the gain ramps down before a voice, holds under it and recovers after it', () => {
  const voices = [[2, 4]] as const;
  assert.equal(duckingGain(voices, DEFAULT_DUCKING, 1), 1);
  assert.equal(duckingGain(voices, DEFAULT_DUCKING, 1.875), 0.625);
  assert.equal(duckingGain(voices, DEFAULT_DUCKING, 3), 0.25);
  assert.equal(duckingGain(voices, DEFAULT_DUCKING, 4.25), 0.625);
  assert.equal(duckingGain(voices, DEFAULT_DUCKING, 5), 1);
});

test('the FFmpeg expression follows the same curve in clip time', () => {
  const voices = [[2, 4], [7, 8]] as const, clipStart = 1.5;
  const expression = duckingExpression(voices, DEFAULT_DUCKING, clipStart, 8)!;
  const evaluate = new Function('t', 'const clip = (v, a, b) => Math.min(b, Math.max(a, v)); const { min, max } = Math; return ' + expression + ';') as (t: number) => number;
  for (const time of [1.5, 1.8, 2, 3, 4.2, 4.6, 6.9, 7.5, 8.3, 9.4]) assert.ok(Math.abs(evaluate(time - clipStart) - duckingGain(voices, DEFAULT_DUCKING, time)) < 1e-3, String(time));
  assert.equal(duckingExpression(voices, DEFAULT_DUCKING, 10, 2), null);
});

test('FFmpeg lowers a tone by about 12 dB under the voice and restores it', () => {
  const expression = duckingExpression([[2, 4]], DEFAULT_DUCKING, 0, 6)!;
  const pcm = execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6:sample_rate=8000', '-af', `volume='${expression}':eval=frame`, '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1'], { maxBuffer: 1 << 20 });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  const rms = (from: number, to: number) => Math.sqrt(samples.slice(from * 8000, to * 8000).reduce((sum, value) => sum + value * value, 0) / ((to - from) * 8000));
  const ratio = rms(2.5, 3.5) / rms(0.5, 1.5);
  assert.ok(Math.abs(20 * Math.log10(ratio) + 12) < 0.5, 'ducked by ' + (20 * Math.log10(ratio)).toFixed(2) + ' dB');
  assert.ok(Math.abs(rms(5, 6) / rms(0.5, 1.5) - 1) < 0.01);
});
