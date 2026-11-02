import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getResolvedCaptionStyle } from './captions';
import { captionWordTimeline, wrapCaptionTokens } from './caption-words';
import type { TimelineClip, TimelineDocument } from './timeline-document';

const time = (value: number) => Math.max(0, value).toFixed(3);

export const escapeFilterPath = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");

export function wrapCaptionForFfmpeg({ text, maxCharacters }: { text: string; maxCharacters: number }) {
  const width = Math.max(4, Math.floor(maxCharacters));
  return text
    .split('\n')
    .flatMap((paragraph) => {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return [''];
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (!line || candidate.length <= width) {
          line = candidate;
          continue;
        }
        lines.push(line);
        line = word;
      }
      if (line) lines.push(line);
      return lines;
    })
    .join('\n');
}

export const visibleCaptionClips = (document: TimelineDocument) =>
  document.tracks
    .filter((track) => track.kind === 'caption' && !track.hidden && !track.muted)
    .flatMap((track) => track.clips)
    .filter((clip) => !clip.muted && clip.text?.trim());

/** The FFmpeg filter captions need: libass for word highlighting, drawtext otherwise. */
export const captionFilterRequirement = (document: TimelineDocument) =>
  visibleCaptionClips(document).length === 0 ? null : document.captionHighlight ? 'ass' : 'drawtext';

/** Arial's ascender + descender in em: libass sizes the line box, drawtext and canvas size the em. */
const ASS_SIZE_PER_EM = 2288 / 2048;

function assColor(color: string, opacity = 1) {
  const rgba = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  const hex = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  const [red, green, blue, alpha] = rgba
    ? [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), (rgba[4] === undefined ? 1 : Number(rgba[4])) * opacity]
    : hex ? [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16), opacity] : [255, 255, 255, opacity];
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase();
  return `&H${byte(255 * (1 - alpha))}${byte(blue)}${byte(green)}${byte(red)}`;
}

const assTime = (seconds: number) => {
  const centis = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centis / 360_000), minutes = Math.floor(centis / 6_000) % 60, secs = Math.floor(centis / 100) % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis % 100).padStart(2, '0')}`;
};

const assText = (value: string) => value.replaceAll('\\', '\u29F5').replaceAll('{', '\uFF5B').replaceAll('}', '\uFF5D');

function captionEvents(clip: TimelineClip, document: TimelineDocument, styleName: string, width: number, height: number, highlight: string) {
  const style = getResolvedCaptionStyle(document, clip);
  const fontSize = Math.max(24, Math.round(height * style.fontScale));
  const text = style.uppercase ? clip.text!.toLocaleUpperCase() : clip.text!;
  const { tokens, words } = captionWordTimeline(clip, text);
  const lines = wrapCaptionTokens(tokens, width * style.maxWidth, (value) => Array.from(value).length * fontSize * 0.56);
  const fill = assColor(style.fillStyle);
  const box = style.backgroundStyle ? `{\\xbord${Math.round(fontSize * style.horizontalPaddingScale)}\\ybord${Math.round(fontSize * style.verticalPaddingScale)}}` : '';
  const render = (active: number) => box + lines.map((line) => line.indices.map((index, position) => {
    const lead = position ? tokens[index].leading.replace('\n', ' ') : '';
    const word = assText(tokens[index].text);
    return lead + (index === active ? `{\\1c${assColor(highlight)}}${word}{\\1c${fill}}` : word);
  }).join('')).join('\\N');
  const clipEnd = clip.startTime + clip.duration;
  const starts = words.map((word) => clip.startTime + word.start - clip.inPoint);
  const spans = [{ from: clip.startTime, to: starts[0] ?? clipEnd, active: -1 }, ...starts.map((start, index) => ({ from: start, to: starts[index + 1] ?? clipEnd, active: index }))];
  return spans
    .map((span) => ({ ...span, from: Math.max(clip.startTime, span.from), to: Math.min(clipEnd, span.to) }))
    .filter((span) => assTime(span.to) > assTime(span.from))
    .map((span) => `Dialogue: 0,${assTime(span.from)},${assTime(span.to)},${styleName},,0,0,0,,${render(span.active)}`);
}

/** An ASS script that reproduces the canvas caption layout and colours the spoken word. */
export function buildCaptionAss({ document, width, height }: { document: TimelineDocument; width: number; height: number }) {
  const highlight = document.captionHighlight ?? '#FFD60A';
  const styles: string[] = [];
  const events: string[] = [];
  visibleCaptionClips(document).forEach((clip, index) => {
    const style = getResolvedCaptionStyle(document, clip);
    const fontSize = Math.max(24, Math.round(height * style.fontScale));
    const boxed = Boolean(style.backgroundStyle);
    const outline = boxed ? 0 : style.strokeStyle ? Math.max(2, Math.round(fontSize * style.strokeScale)) / 2 : 0;
    const name = `c${index + 1}`;
    styles.push(`Style: ${name},Arial,${Math.round(fontSize * ASS_SIZE_PER_EM)},${assColor(style.fillStyle)},${assColor(style.fillStyle)},` +
      `${assColor(boxed ? style.backgroundStyle! : style.strokeStyle ?? 'rgba(0,0,0,0)')},&HFF000000,${style.fontWeight >= 700 ? -1 : 0},0,0,0,100,100,0,0,` +
      `${boxed ? 3 : 1},${outline},0,2,0,0,${Math.round(height * style.bottomOffset)},1`);
    events.push(...captionEvents(clip, document, name, width, height, highlight));
  });
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles, '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...events, '',
  ].join('\n');
}

/** Caption filters for the server export: one libass pass when highlighting, drawtext per cue otherwise. */
export async function buildCaptionFilters({ document, directory, width, height, visualLabel }: {
  document: TimelineDocument; directory: string; width: number; height: number; visualLabel: string;
}) {
  const clips = visibleCaptionClips(document);
  if (!clips.length) return { filters: [] as string[], output: visualLabel };
  if (document.captionHighlight) {
    const path = join(directory, 'captions.ass');
    await writeFile(path, buildCaptionAss({ document, width, height }), 'utf8');
    return { filters: [`[${visualLabel}]ass=filename='${escapeFilterPath(path)}'[withcaptions]`], output: 'withcaptions' };
  }
  const filters: string[] = [];
  let label = visualLabel;
  for (const [index, clip] of clips.entries()) {
    const style = getResolvedCaptionStyle(document, clip);
    const fontSize = Math.max(24, Math.round(height * style.fontScale));
    const maxCharacters = (width * style.maxWidth) / (fontSize * 0.56);
    const textPath = join(directory, `caption-${index + 1}.txt`);
    await writeFile(textPath, wrapCaptionForFfmpeg({ text: style.uppercase ? clip.text!.toLocaleUpperCase() : clip.text!, maxCharacters }), 'utf8');
    const next = `withcaption${index + 1}`;
    const options = [
      `font=${style.fontWeight >= 700 ? 'Arial Bold' : 'Arial'}`,
      `textfile='${escapeFilterPath(textPath)}'`,
      'expansion=none',
      `fontsize=${fontSize}`,
      `fontcolor=${style.fillStyle}`,
      `line_spacing=${Math.round(fontSize * (style.lineHeight - 1))}`,
      'x=(w-text_w)/2',
      `y=h-${Math.round(height * style.bottomOffset)}-text_h`,
      `enable='between(t,${time(clip.startTime)},${time(clip.startTime + clip.duration)})'`,
    ];
    if (style.strokeStyle) options.push(`borderw=${Math.max(2, Math.round(fontSize * style.strokeScale))}`, 'bordercolor=black@0.9');
    if (style.backgroundStyle) options.push('box=1', 'boxcolor=black@0.82', `boxborderw=${Math.max(4, Math.round(fontSize * style.horizontalPaddingScale))}`);
    filters.push(`[${label}]drawtext=${options.join(':')}[${next}]`);
    label = next;
  }
  return { filters, output: label };
}
