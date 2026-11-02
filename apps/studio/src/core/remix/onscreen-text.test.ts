import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTextBlocks, parseTesseractTsv, trackTextSegments, type TextBlock } from './onscreen-text';
import { cameraKeyframes } from './camera-keyframes';
import { captionIntervals } from './rebuild';

const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const word = (block: number, line: number, left: number, top: number, width: number, height: number, conf: number, text: string) => ['5', '1', block, 1, line, 1, left, top, width, height, conf, text].join('\t');
const block = (text: string, y: number, confidence = 95): TextBlock => ({ text, box: { x: 0.3, y, width: 0.4, height: 0.08 }, confidence, lines: 1 });

test('Tesseract words become positioned blocks without texture, stray edges or oversized boxes', () => {
  const tsv = [header, word(1, 1, 132, 30, 112, 34, 96, 'SAVE'), word(1, 1, 261, 30, 107, 34, 95, 'THIS'), word(1, 1, 390, 30, 119, 34, 97, 'HACK'),
    word(1, 2, 260, 70, 100, 30, 92, '‘today!'), word(2, 1, 107, 19, 10, 56, 84, '|'), word(3, 1, 20, 0, 620, 360, 90, '$3333'), word(4, 1, 479, 111, 21, 12, 69, 'Ww')].join('\n');
  assert.deepEqual(parseTesseractTsv(tsv, 640, 360), [
    { text: 'SAVE THIS HACK\ntoday!', lines: 2, confidence: 95, box: { x: 0.206, y: 0.083, width: 0.589, height: 0.194 } },
  ]);
});

test('two readings of a frame keep the more confident text at each place', () => {
  const plain = [block('PART', 0.8, 60), block('Sale ends today', 0.1, 90)], edges = [block('PART 2', 0.8, 94)];
  assert.deepEqual(mergeTextBlocks(plain, edges).map(item => item.text), ['Sale ends today', 'PART 2']);
});

test('text at one place is followed while it stays on screen, and a watermark is dropped', () => {
  const watermark = { ...block('@studio', 0.95), box: { x: 0.8, y: 0.95, width: 0.15, height: 0.02 } };
  const frames = [0, 1, 2, 3, 4, 5].map(time => ({ time, blocks: [watermark, ...(time < 2 ? [block('SAVE THIS HACK', 0.1)] : []), ...(time >= 4 ? [block(time === 4 ? 'PART 2!' : 'PART', 0.8, time === 4 ? 95 : 93)] : [])] }));
  const segments = trackTextSegments(frames, 1, 6);
  assert.deepEqual(segments.map(segment => [segment.start, segment.end, segment.text]), [[0, 2, 'SAVE THIS HACK'], [4, 6, 'PART 2!']]);
});

test('text on screen together becomes one caption that changes when any of it changes', () => {
  const box = (y: number) => ({ x: 0.2, y, width: 0.6, height: 0.08 });
  assert.deepEqual(captionIntervals([{ start: 0, end: 3, text: 'Top', box: box(0.1), lines: 1 }, { start: 1, end: 2, text: 'Bottom', box: box(0.8), lines: 1 }]).map(item => [item.start, item.end, item.text, item.lines]), [
    [0, 1, 'Top', 1], [1, 2, 'Top\nBottom', 2], [2, 3, 'Top', 1],
  ]);
});

test('camera keyframes keep a still covering the frame while it zooms, pans or tilts', () => {
  const move = (kind: string, values: Partial<{ pan: number; tilt: number; zoom: number }> = {}) => ({ kind, pan: 0, tilt: 0, zoom: 1, ...values }) as Parameters<typeof cameraKeyframes>[0];
  const portrait = 9 / 16;
  const zoom = cameraKeyframes(move('zoom-in', { zoom: 1.2 }), 2, 1, portrait)!.keyframes;
  assert.deepEqual(zoom.map(frame => [frame.time, frame.x, frame.y, frame.width]), [[0, 0.5, 0.5, 1.7778], [2, 0.5, 0.5, 2]]);
  const pan = cameraKeyframes(move('pan-right', { pan: 0.4 }), 1.5, 16 / 9, 16 / 9)!.keyframes;
  assert.deepEqual(pan.map(frame => [frame.x, frame.width]), [[0.62, 1.24], [0.38, 1.24]]);
  const tilt = cameraKeyframes(move('tilt-down', { tilt: 0.1 }), 1, 16 / 9, 16 / 9)!.keyframes;
  assert.ok(tilt[0].y > 0.5 && tilt[1].y < 0.5 && tilt[0].width >= 1.1);
  for (const frame of [...zoom, ...pan, ...tilt]) {
    // Half the drawn width and height still reach every edge of the frame.
    const aspect = frame === zoom[0] || frame === zoom[1] ? 1 : 16 / 9, frameAspect = frame === zoom[0] || frame === zoom[1] ? portrait : 16 / 9;
    assert.ok(frame.width / 2 >= Math.abs(frame.x - 0.5) + 0.5 - 1e-3 && (frame.width * frameAspect) / aspect / 2 >= Math.abs(frame.y - 0.5) + 0.5 - 1e-3, JSON.stringify(frame));
  }
  assert.equal(cameraKeyframes(move('static'), 2, 1, 1), null);
  assert.equal(cameraKeyframes(move('zoom-in', { zoom: 1.5 }), 2, 1, 0.25), null, 'already at the widest overlay');
});
