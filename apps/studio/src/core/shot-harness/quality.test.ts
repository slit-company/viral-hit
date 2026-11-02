import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAnalysisLog, scoreTake } from './quality';

const log = [
  '[Parsed_scdet_2 @ 0x1] lavfi.scd.score: 41.6, lavfi.scd.time: 3',
  '[Parsed_freezedetect_0 @ 0x1] lavfi.freezedetect.freeze_start: 3',
  '[Parsed_blackdetect_1 @ 0x1] black_start:3 black_end:3.958 black_duration:0.958',
  '[Parsed_volumedetect_0 @ 0x1] max_volume: -60.0 dB',
].join('\n');

test('a take that cuts to a frozen black tail is sent back for another try', () => {
  const parsed = parseAnalysisLog(log, 4);
  assert.deepEqual(parsed, { frozenSec: 1, blackSec: 0.958, cuts: [3], maxVolumeDb: -60 });
  const quality = scoreTake({ durationSec: 4, width: 1280, height: 720, fps: 24, hasAudio: true, ...parsed }, { durationSec: 5, audio: true });
  assert.deepEqual(quality.issues, ['short', 'frozen', 'black', 'cuts', 'silent']);
  assert.equal(quality.verdict, 'retry');
});

test('a clean 1080p take passes', () => {
  const quality = scoreTake({ durationSec: 5, width: 1920, height: 1080, fps: 24, frozenSec: 0, blackSec: 0, cuts: [], hasAudio: false, maxVolumeDb: null }, { durationSec: 5 });
  assert.deepEqual([quality.score, quality.verdict, quality.issues], [100, 'good', []]);
});
