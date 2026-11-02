import { findCaptionAtTime, getResolvedCaptionStyle } from './captions';
import { activeCaptionWordIndex, captionWordTimeline, wrapCaptionTokens } from './caption-words';
import type { TimelineDocument } from './timeline-document';

export function wrapCaptionText(text: string, maxWidth: number, measure: (value: string) => number) {
  const wrapped: string[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const pushParagraph = (paragraph: string) => {
    if (!paragraph) {
      wrapped.push('');
      return;
    }
    const tokens = Array.from(segmenter.segment(paragraph), ({ segment }) => segment);
    let line = '';
    for (const token of tokens) {
      const candidate = `${line}${token}`;
      if (!line || measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      wrapped.push(line.trimEnd());
      if (measure(token) <= maxWidth) {
        line = token.trimStart();
        continue;
      }
      line = '';
      for (const character of Array.from(token)) {
        const characterCandidate = `${line}${character}`;
        if (line && measure(characterCandidate) > maxWidth) {
          wrapped.push(line);
          line = character;
        } else {
          line = characterCandidate;
        }
      }
    }
    if (line) wrapped.push(line.trimEnd());
  };
  for (const paragraph of text.split('\n')) pushParagraph(paragraph);
  return wrapped;
}

function drawRoundedCaptionBackground(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
  context.fill();
}

/** Draw the caption visible at `timelineTime`, colouring the spoken word when highlighting is on. */
export function drawTimelineCaption(context: CanvasRenderingContext2D, document: TimelineDocument, timelineTime: number, width: number, height: number) {
  const caption = findCaptionAtTime(document, timelineTime);
  if (!caption?.text) return;
  const style = getResolvedCaptionStyle(document, caption);
  const fontSize = Math.max(24, Math.round(height * style.fontScale));
  context.font = `${style.fontWeight} ${fontSize}px sans-serif`;
  context.textBaseline = 'bottom';
  const text = style.uppercase ? caption.text.toLocaleUpperCase() : caption.text;
  const measure = (value: string) => context.measureText(value).width;
  const highlight = document.captionHighlight ?? null;
  const timeline = highlight ? captionWordTimeline(caption, text) : null;
  const tokenLines = timeline ? wrapCaptionTokens(timeline.tokens, width * style.maxWidth, measure) : null;
  const lines = tokenLines ? tokenLines.map((line) => line.text) : wrapCaptionText(text, width * style.maxWidth, measure);
  const active = timeline ? activeCaptionWordIndex(timeline.words, caption.inPoint + timelineTime - caption.startTime) : -1;
  const lineHeight = fontSize * style.lineHeight;
  const baseY = height - Math.round(height * style.bottomOffset);
  if (style.backgroundStyle) {
    const textWidth = Math.max(...lines.map(measure), fontSize);
    const horizontalPadding = fontSize * style.horizontalPaddingScale;
    const verticalPadding = fontSize * style.verticalPaddingScale;
    context.fillStyle = style.backgroundStyle;
    drawRoundedCaptionBackground(context, (width - textWidth) / 2 - horizontalPadding, baseY - lineHeight * lines.length - verticalPadding,
      textWidth + horizontalPadding * 2, lineHeight * lines.length + verticalPadding * 2, fontSize * 0.24);
  }
  lines.forEach((line, index) => {
    const y = baseY - (lines.length - 1 - index) * lineHeight;
    const left = width / 2 - measure(line) / 2;
    context.textAlign = 'left';
    if (style.strokeStyle) {
      context.lineWidth = Math.max(2, Math.round(fontSize * style.strokeScale));
      context.strokeStyle = style.strokeStyle;
      context.lineJoin = 'round';
      context.strokeText(line, left, y);
    }
    context.fillStyle = style.fillStyle;
    context.fillText(line, left, y);
    const position = tokenLines?.[index].indices.indexOf(active) ?? -1;
    if (highlight && timeline && position >= 0) {
      context.fillStyle = highlight;
      context.fillText(timeline.tokens[active].text, left + measure(tokenLines![index].prefix(position)), y);
    }
  });
}
