import { Fragment } from 'react';
import { activeCaptionWordIndex, captionWordTimeline } from '@/core/editor/caption-words';
import type { TimelineClip } from '@/core/editor/timeline-document';

/** Caption text for the preview; with highlighting on, the spoken word takes the highlight colour. */
export function CaptionPreviewText({ clip, time, highlight, uppercase }: {
  clip: TimelineClip; time: number; highlight: string | null | undefined; uppercase: boolean;
}) {
  const text = clip.text ?? '';
  if (!highlight) return <>{text}</>;
  const { tokens, words } = captionWordTimeline(clip, uppercase ? text.toLocaleUpperCase() : text);
  const active = activeCaptionWordIndex(words, clip.inPoint + time - clip.startTime);
  return <>{tokens.map((token, index) => <Fragment key={index}>
    {index ? (token.leading === '\n' ? <br /> : token.leading) : null}
    <span style={index === active ? { color: highlight } : undefined}>{token.text}</span>
  </Fragment>)}</>;
}
