import { getTimelineClipSource, type TimelineClip } from './timeline-document';
import type { CaptionWord } from './caption-words';

/**
 * The words heard inside an audio clip, moved to timeline time. Words cut off by the clip's trim are
 * dropped; a word crossing an edge is kept only when most of it is audible.
 */
export function voiceWordsOnTimeline(clip: TimelineClip, words: readonly CaptionWord[]) {
  const source = getTimelineClipSource(clip);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return words.flatMap((word) => {
    const start = Math.max(word.start, source.inPoint), end = Math.min(word.end, source.outPoint);
    if (end <= start || end - start < (word.end - word.start) / 2) return [];
    return [{ text: word.text, start: round(clip.startTime + start - source.inPoint), end: round(clip.startTime + end - source.inPoint) }];
  });
}
