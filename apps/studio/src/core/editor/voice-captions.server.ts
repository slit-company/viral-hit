import { readAssetSpeechWords } from '@/core/effects/speech-words.server';
import type { EditorOperation } from '@/core/commands/editor-commands';
import { getTimelineClipSource, type TimelineDocument } from './timeline-document';
import { voiceWordsOnTimeline } from './voice-captions';

/** The captions_from_words operation for a voice clip whose audio came with word timing. */
export async function voiceCaptionOperation({ projectId, document, clipId, replace }: {
  projectId: string; document: TimelineDocument; clipId: string; replace?: boolean;
}): Promise<EditorOperation> {
  const clip = document.tracks.filter((track) => track.kind === 'audio').flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
  if (!clip) throw new Error(`Audio clip ${clipId} was not found.`);
  const words = await readAssetSpeechWords({ projectId, assetId: getTimelineClipSource(clip).assetId });
  if (!words) throw new Error('This audio has no word timing. Generate the voice with a provider that returns timing (ElevenLabs speech), or set caption words with set_caption_words.');
  const timed = voiceWordsOnTimeline(clip, words);
  if (!timed.length) throw new Error('No timed words fall inside the visible part of this clip.');
  return { type: 'captions_from_words', words: timed, ...(replace ? { replace: true } : {}) };
}
