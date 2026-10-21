import { useEffect, useRef, useState } from 'react';
import { Action } from '@/components/base/action';
import { readTranscriptOutput, transcriptSrt } from '@/core/transcripts/contract';

export function TranscriptResult({ projectId, output }: { projectId: string; output: string | null }) {
  const transcript = readTranscriptOutput(output), [selected, setSelected] = useState(0), [failed, setFailed] = useState(false);
  const player = useRef<HTMLMediaElement | null>(null);
  const segment = transcript?.segments[selected], start = segment?.start ?? transcript?.range.start, end = segment?.end ?? transcript?.range.end;
  function seek() { if (player.current && player.current.readyState >= 1 && start !== undefined) player.current.currentTime = start; }
  useEffect(() => { setFailed(false); seek(); }, [transcript?.source.assetId, start]);
  if (!transcript || transcript.source.projectId !== projectId) return null;
  const media = {
    ref: (node: HTMLMediaElement | null) => { player.current = node; }, controls: true, preload: 'metadata',
    src: `/api/app/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(transcript.source.assetId)}`,
    onLoadedMetadata: seek, onError: () => setFailed(true),
    onPlay: () => { if (player.current && start !== undefined && end !== undefined && (player.current.currentTime < start || player.current.currentTime >= end)) seek(); },
    onTimeUpdate: () => { if (player.current && end !== undefined && player.current.currentTime >= end) player.current.pause(); },
  };
  function download() {
    const url = URL.createObjectURL(new Blob([transcriptSrt(transcript!)], { type: 'application/x-subrip;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `captions-${transcript!.source.assetId}.srt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section aria-label="Speech transcript" className="mt-3 space-y-3 border-t border-[var(--vh-border)] pt-3">
    <p className="font-medium">Automatic transcript · {transcript.language.toUpperCase()}</p>
    <p className="text-xs leading-5 text-[var(--vh-text-2)]">Review words and timing against the recording. Recognition can miss speech or add incorrect words.</p>
    {transcript.source.kind === 'video' ? <video {...media} key={transcript.source.assetId} playsInline aria-label="Transcript source preview" className="max-h-40 w-full rounded-xl bg-black" /> : <audio {...media} key={transcript.source.assetId} aria-label="Transcript source preview" className="w-full" />}
    {failed && <p role="alert">Original recording could not load. Verify the source before using this transcript.</p>}
    <p className="text-xs tabular-nums">Source range: {transcript.range.start.toFixed(3)}–{transcript.range.end.toFixed(3)}s · {transcript.segments.length} captions</p>
    {Boolean(transcript.timingAdjusted || transcript.segmentsOmitted) && <p className="text-xs text-[var(--vh-text-2)]">{transcript.timingAdjusted} timings adjusted to fit · {transcript.segmentsOmitted} empty or out-of-range segments omitted.</p>}
    {transcript.segments.length ? <div aria-label="Transcript segments" className="max-h-48 space-y-2 overflow-y-auto">
      {transcript.segments.map((item, index) => <Action key={index} aria-label={`Preview caption ${index + 1}`} aria-pressed={selected === index} className={'h-auto! w-full min-w-0 flex-col! items-start! whitespace-normal! rounded-lg! px-3! py-2! text-left! ' + (selected === index ? 'vh-primary' : 'vh-secondary')} onClick={() => { player.current?.pause(); if (player.current && player.current.readyState >= 1) player.current.currentTime = item.start; setSelected(index); }}>
        <span className="text-[10px] tabular-nums">{item.start.toFixed(2)}–{item.end.toFixed(2)}s</span><span className="break-words text-xs leading-5">{item.text}</span>
      </Action>)}
    </div> : <p className="text-xs">No speech segments returned. The caption track stays empty; listen to the source to check for missed speech.</p>}
    <div className="flex flex-wrap items-center gap-3"><Action disabled={!transcript.segments.length} onClick={download} className="vh-secondary text-xs!">Download SRT</Action><span className="text-[10px] text-[var(--vh-text-2)]">Times start at zero for this range.</span></div>
    <p className="text-[10px] text-[var(--vh-text-2)]">{transcript.engine.id} · {transcript.engine.model}</p>
  </section>;
}
