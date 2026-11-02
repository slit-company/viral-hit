import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyEditorOperations } from '../commands/editor-commands';
import { editorOperationSchema } from '../commands/schema';
import { buildCaptionAss } from './caption-render.server';
import { activeCaptionWordIndex, captionCuesFromWords, captionWordTimeline, estimateCaptionWords, retimeCaptionWords, tokenizeCaption } from './caption-words';
import { createTimelineDocument, findTimelineClip, normalizeTimelineDocument, type TimelineDocument } from './timeline-document';

const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const words = (pairs: [string, number, number][]) => pairs.map(([text, start, end]) => ({ text, start, end }));

test('tokens follow spaces, keep punctuation and split Chinese/Japanese runs per character', () => {
  assert.deepEqual(tokenizeCaption('Hello, world!').map((token) => token.text), ['Hello,', 'world!']);
  assert.deepEqual(tokenizeCaption('오늘 운세 보러 가자').map((token) => token.text), ['오늘', '운세', '보러', '가자']);
  assert.deepEqual(tokenizeCaption('你好，世界。').map((token) => token.text), ['你', '好，', '世', '界。']);
  assert.deepEqual(tokenizeCaption('one\ntwo').map((token) => token.leading), ['', '\n']);
  const estimate = estimateCaptionWords(tokenizeCaption('a extraordinary b'), 0, 3);
  assert.equal(estimate[2].end, 3);
  assert.ok(estimate[1].end - estimate[1].start > estimate[0].end - estimate[0].start);
  assert.equal(activeCaptionWordIndex(estimate, -0.1), -1);
  assert.equal(activeCaptionWordIndex(estimate, estimate[1].start + 0.01), 1);
});

test('rewriting a sentence keeps unchanged word timings and fits new words into the freed time', () => {
  const previous = words([['This', 0, 0.4], ['is', 0.4, 0.6], ['a', 0.6, 0.7], ['test', 0.7, 1.2]]);
  const replaced = retimeCaptionWords(previous, 'This is the best test', 0, 1.2)!;
  assert.deepEqual(replaced.map((word) => word.text), ['This', 'is', 'the', 'best', 'test']);
  assert.deepEqual([replaced[0], replaced[4]].map((word) => [word.start, word.end]), [[0, 0.4], [0.7, 1.2]]);
  assert.deepEqual([replaced[1].start, replaced[1].end], [0.4, 0.5], 'a short replacement borrows half of its neighbour');
  assert.ok(replaced[2].start >= 0.5 && replaced[3].end <= 0.7 && replaced[2].end <= replaced[3].start + 1e-9);
  const appended = retimeCaptionWords(previous, 'This is a test now', 0, 1.2)!;
  assert.ok(appended[3].end <= appended[4].start + 1e-9 && appended[4].end === 1.2, 'an appended word borrows from its neighbour');
  assert.equal(retimeCaptionWords(previous, 'Completely different words', 0, 1.2), null);
});

test('caption commands store measured words, re-time them on text edits and build cues from voice alignment', () => {
  let document = createTimelineDocument({ projectId: 'captions', name: 'Captions' });
  document = applyEditorOperations(document, [{ type: 'upsert_caption', clipId: 'cue', text: 'Find the hit', startTime: 2, duration: 1.5 }]).document;
  const measured = editorOperationSchema.parse({ type: 'set_caption_words', clipId: 'cue', words: words([['Find', 0, 0.5], ['the', 0.5, 0.7], ['hit', 0.7, 1.5]]) });
  document = applyEditorOperations(document, [measured, { type: 'set_caption_highlight', color: '#ffd60a' }]).document;
  assert.equal(document.captionHighlight, '#FFD60A');
  assert.equal(captionWordTimeline(findTimelineClip(document, 'cue')!).measured, true);
  assert.throws(() => applyEditorOperations(document, [{ type: 'set_caption_words', clipId: 'cue', words: words([['Lose', 0, 1]]) }]), /match the caption text/);
  document = applyEditorOperations(document, [{ type: 'upsert_caption', clipId: 'cue', text: 'Find the next hit', startTime: 2, duration: 1.5 }]).document;
  const edited = findTimelineClip(document, 'cue')!;
  assert.deepEqual(edited.words?.map((word) => word.text), ['Find', 'the', 'next', 'hit']);
  assert.deepEqual(edited.words?.[0], { text: 'Find', start: 0, end: 0.5 });
  assert.equal(normalizeTimelineDocument(JSON.parse(JSON.stringify(document))).captionHighlight, '#FFD60A');
  const voice = words([['Ship', 0.2, 0.5], ['it.', 0.5, 0.9], ['Then', 1.8, 2.1], ['measure', 2.1, 2.6], ['it', 2.6, 2.8], ['。', 2.8, 2.85]]);
  const cues = captionCuesFromWords(voice);
  assert.deepEqual(cues.map((cue) => cue.text), ['Ship it.', 'Then measure it。']);
  assert.deepEqual(cues[1].words[0], { text: 'Then', start: 0, end: 0.3 });
  assert.deepEqual(captionCuesFromWords(words([['你好', 0, 1]]))[0].words.map((word) => word.text), ['你', '好']);
  document = applyEditorOperations(document, [{ type: 'captions_from_words', words: voice, replace: true }]).document;
  const track = document.tracks.find((candidate) => candidate.kind === 'caption')!;
  assert.deepEqual(track.clips.map((clip) => [clip.startTime, clip.text]), [[0.2, 'Ship it.'], [1.8, 'Then measure it。']]);
  assert.ok(track.clips.every((clip) => captionWordTimeline(clip).measured));
});

test('real libass export colours exactly the spoken word at the canvas caption position', () => {
  let document: TimelineDocument = createTimelineDocument({ projectId: 'ass', name: 'ASS' });
  document = applyEditorOperations(document, [
    { type: 'upsert_caption', clipId: 'cue', text: 'ONE TWO THREE', startTime: 0, duration: 3 },
    { type: 'set_caption_words', clipId: 'cue', words: words([['ONE', 0, 1], ['TWO', 1, 2], ['THREE', 2, 3]]) },
    { type: 'set_caption_style', preset: 'bold' },
    { type: 'set_caption_highlight', color: '#FFD60A' },
  ]).document;
  const width = 640, height = 360;
  const directory = mkdtempSync(join(tmpdir(), 'vh-ass-'));
  try {
    const file = join(directory, 'captions.ass');
    writeFileSync(file, buildCaptionAss({ document, width, height }));
    const raw = execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${width}x${height}:r=10:d=3`, '-vf', `ass=${file}`, '-frames:v', '30', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
    const spans = (frame: number) => {
      let yellowMin = width, yellowMax = -1, whiteMin = width, whiteMax = -1, bottom = -1;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const offset = ((frame * height + y) * width + x) * 3;
        const [r, g, b] = [raw[offset], raw[offset + 1], raw[offset + 2]];
        if (r > 200 && g > 170 && b < 90) { yellowMin = Math.min(yellowMin, x); yellowMax = Math.max(yellowMax, x); }
        if (r > 220 && g > 220 && b > 220) { whiteMin = Math.min(whiteMin, x); whiteMax = Math.max(whiteMax, x); bottom = Math.max(bottom, y); }
      }
      return { yellowMin, yellowMax, whiteMin, whiteMax, bottom };
    };
    const first = spans(5), second = spans(15), third = spans(25);
    assert.ok(first.yellowMax < second.yellowMin && second.yellowMax < third.yellowMin, JSON.stringify({ first, second, third }));
    assert.ok(first.whiteMax > second.yellowMax && third.whiteMin < second.yellowMin, 'the other words stay white');
    assert.ok(Math.abs((first.yellowMin + third.yellowMax) / 2 - width / 2) < 12, 'the line is centred');
    assert.ok(first.bottom > height * 0.8 && first.bottom < height * 0.92, `bottom offset ${first.bottom}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
