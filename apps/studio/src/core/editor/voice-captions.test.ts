import assert from 'node:assert/strict';
import test from 'node:test';
import { addSourceClip, createTimelineDocument, findTimelineClip } from './timeline-document';
import { applyEditorOperations } from '../commands/editor-commands';
import { voiceWordsOnTimeline } from './voice-captions';

const words = [{ text: 'Find', start: 0.1, end: 0.5 }, { text: 'the', start: 0.6, end: 0.8 }, { text: 'next', start: 0.9, end: 1.3 }, { text: 'hit.', start: 1.4, end: 1.9 }];

test('voice words move to timeline time and respect the clip trim', () => {
  let document = addSourceClip(createTimelineDocument({ projectId: 'voice', name: 'Voice' }), { clipId: 'voice', assetId: 'voice', sourceUrl: '/voice', name: 'Voice', sourceType: 'audio', sourceDuration: 2, startTime: 3 });
  assert.deepEqual(voiceWordsOnTimeline(findTimelineClip(document, 'voice')!, words).map((word) => [word.text, word.start, word.end]), [['Find', 3.1, 3.5], ['the', 3.6, 3.8], ['next', 3.9, 4.3], ['hit.', 4.4, 4.9]]);
  document = applyEditorOperations(document, [{ type: 'trim_clip', clipId: 'voice', inPoint: 0.75, outPoint: 1.6 }]).document;
  const trimmed = findTimelineClip(document, 'voice')!;
  assert.deepEqual(voiceWordsOnTimeline(trimmed, words).map((word) => word.text), ['next'], 'a word mostly cut off by the trim is dropped');
  const captioned = applyEditorOperations(document, [{ type: 'captions_from_words', words: voiceWordsOnTimeline(trimmed, words) }]).document;
  assert.equal(captioned.tracks.find((track) => track.kind === 'caption')?.clips[0].startTime, Math.round((trimmed.startTime + 0.15) * 1000) / 1000);
});
