import { useQuery } from '@tanstack/react-query';
import { Captions } from 'lucide-react';
import { m } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import type { EditorOperation } from '@/core/commands/editor-commands';
import type { CaptionWord } from '@/core/editor/caption-words';
import { getTimelineClipSource, type TimelineClip } from '@/core/editor/timeline-document';
import { voiceWordsOnTimeline } from '@/core/editor/voice-captions';
import { apiJsonGet } from '@/lib/api-client';

/** For narration a voice provider timed word by word: one action builds captions from that timing. */
export function VoiceCaptionsAction({ projectId, clip, locked, onEdit }: {
  projectId: string; clip: TimelineClip; locked: boolean; onEdit: (operation: EditorOperation) => void;
}) {
  const assetId = getTimelineClipSource(clip).assetId;
  const words = useQuery({
    queryKey: ['speech-words', projectId, assetId],
    queryFn: () => apiJsonGet<{ words: CaptionWord[] | null }>(`/api/app/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/speech-words`).then(result => result.words),
    staleTime: 60_000, retry: false,
  });
  const timed = words.data ? voiceWordsOnTimeline(clip, words.data) : [];
  if (!timed.length) return null;
  return <div className="space-y-2 border-t border-[var(--vh-border)] pt-3">
    <Action type="button" disabled={locked} onClick={() => onEdit({ type: 'captions_from_words', words: timed })}
      className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] text-[11px] font-[550]">
      <Captions className="size-3.5" aria-hidden="true" />{m['ui.editor.voice_captions']({ count: timed.length })}
    </Action>
    <p className="text-[10px] leading-4 text-[var(--vh-text-2)]">{m['ui.editor.voice_captions_hint']()}</p>
  </div>;
}
