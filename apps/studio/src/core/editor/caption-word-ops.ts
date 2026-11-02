import { ensureCaptionTrack, upsertCaptionCue } from './captions';
import { captionCuesFromWords, tokenizeCaption, validateCaptionWords, type CaptionWord, type TimedWord } from './caption-words';
import type { TimelineDocument } from './timeline-document';

const normalize = (text: string) => text.toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, '');

/** Colour the word being spoken in every caption, or turn highlighting off with null. */
export function setCaptionHighlight(document: TimelineDocument, color: string | null): TimelineDocument {
  return { ...document, captionHighlight: color ? color.toUpperCase() : null, updatedAt: new Date().toISOString() };
}

/** Store measured word timings for one caption; the words must spell its text in order. */
export function setCaptionWords(document: TimelineDocument, clipId: string, words: CaptionWord[] | null): TimelineDocument {
  const track = document.tracks.find((candidate) => candidate.kind === 'caption' && candidate.clips.some((clip) => clip.id === clipId));
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!track || !clip || track.locked) return document;
  if (words) {
    const tokens = tokenizeCaption(clip.text ?? '');
    if (tokens.length !== words.length || tokens.some((token, index) => normalize(token.text) !== normalize(words[index].text))) {
      throw new Error('Caption words must match the caption text word by word.');
    }
    if (!validateCaptionWords(words, clip.sourceDuration)) throw new Error('Caption words must be ordered and fit the caption.');
  }
  const clips = track.clips.map((candidate) => {
    if (candidate.id !== clipId) return candidate;
    const { words: _previous, ...rest } = candidate;
    return words ? { ...rest, words: words.map((word) => ({ ...word })) } : rest;
  });
  return { ...document, updatedAt: new Date().toISOString(), tracks: document.tracks.map((candidate) => (candidate.id === track.id ? { ...candidate, clips } : candidate)) };
}

/** Turn absolute word timings, such as a voice provider's alignment, into timed caption cues. */
export function addCaptionsFromWords(
  document: TimelineDocument,
  words: readonly TimedWord[],
  { replace = false, idPrefix = 'caption', ...grouping }: { replace?: boolean; idPrefix?: string; maxWords?: number; maxSeconds?: number; maxCharacters?: number } = {}
) {
  const cues = captionCuesFromWords(words, grouping);
  if (!cues.length) return document;
  let next = ensureCaptionTrack(document);
  if (replace) next = { ...next, tracks: next.tracks.map((track) => (track.kind === 'caption' ? { ...track, clips: [] } : track)) };
  cues.forEach((cue, index) => {
    const clipId = `${idPrefix}-${index + 1}-${Math.round(cue.startTime * 1000)}`;
    next = upsertCaptionCue(next, { clipId, text: cue.text, startTime: cue.startTime, endTime: cue.endTime });
    next = setCaptionWords(next, clipId, cue.words);
  });
  return next;
}
