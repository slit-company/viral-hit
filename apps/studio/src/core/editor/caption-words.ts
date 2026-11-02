import { z } from 'zod';

/**
 * Word timing for caption clips. Times are in caption source seconds (the same
 * coordinates as inPoint/outPoint), so moving a cue keeps its words aligned.
 * Missing or stale timings fall back to an estimate weighted by word length.
 */
export const MAX_CAPTION_WORDS = 300;

export type CaptionWord = { text: string; start: number; end: number };
export type CaptionToken = { text: string; leading: '' | ' ' | '\n' };

export const captionWordSchema = z
  .object({ text: z.string().trim().min(1).max(80), start: z.number().finite().min(0).max(86_400), end: z.number().finite().min(0).max(86_400) })
  .strict();
export const captionWordsSchema = z.array(captionWordSchema).max(MAX_CAPTION_WORDS);
export const captionHighlightSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Highlight colours offered in the editor; any #RRGGBB is accepted by commands. */
export const CAPTION_HIGHLIGHT_COLORS = ['#FFD60A', '#A3E635', '#22D3EE', '#F472B6'] as const;

const IDEOGRAPHIC = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const PUNCTUATION = /^[\p{P}\p{S}]+$/u;
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Words split on spaces; Chinese/Japanese runs split per character with punctuation kept on the previous one. */
export function tokenizeCaption(text: string): CaptionToken[] {
  const tokens: CaptionToken[] = [];
  let pending: CaptionToken['leading'] = '';
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      pending = part.includes('\n') ? '\n' : ' ';
      continue;
    }
    const leading = tokens.length ? pending : '';
    pending = '';
    if (!IDEOGRAPHIC.test(part)) {
      tokens.push({ text: part, leading });
      continue;
    }
    Array.from(part).forEach((character, index) => {
      if (index > 0 && PUNCTUATION.test(character)) tokens[tokens.length - 1].text += character;
      else tokens.push({ text: character, leading: index === 0 ? leading : '' });
    });
  }
  return tokens;
}

export const joinCaptionTokens = (tokens: readonly CaptionToken[]) => tokens.map((token, index) => (index ? token.leading : '') + token.text).join('');

/** Greedy line breaking over tokens; lines hold token indices and honour explicit newlines. */
export function wrapCaptionTokens(tokens: readonly CaptionToken[], maxWidth: number, measure: (value: string) => number) {
  const lineText = (indices: readonly number[]) => indices.map((index, position) => (position ? tokens[index].leading.replace('\n', ' ') : '') + tokens[index].text).join('');
  const lines: number[][] = [];
  let current: number[] = [];
  tokens.forEach((token, index) => {
    if (token.leading === '\n' && current.length) {
      lines.push(current);
      current = [];
    }
    if (!current.length || measure(lineText([...current, index])) <= maxWidth) current = [...current, index];
    else {
      lines.push(current);
      current = [index];
    }
  });
  if (current.length) lines.push(current);
  return lines.map((indices) => ({ indices, text: lineText(indices), prefix: (position: number) => lineText(indices.slice(0, position)) + (position ? tokens[indices[position]].leading.replace('\n', ' ') : '') }));
}

const normalize = (text: string) => text.toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, '');
const weight = (text: string) => Math.max(1, Array.from(normalize(text) || text).length) + 0.6;

function spread(tokens: readonly Pick<CaptionToken, 'text'>[], start: number, end: number): CaptionWord[] {
  const total = tokens.reduce((sum, token) => sum + weight(token.text), 0);
  const span = Math.max(0, end - start);
  let cursor = start;
  return tokens.map((token, index) => {
    const next = index === tokens.length - 1 ? end : cursor + (span * weight(token.text)) / total;
    const word = { text: token.text, start: round(cursor), end: round(next) };
    cursor = next;
    return word;
  });
}

export const estimateCaptionWords = (tokens: readonly CaptionToken[], start: number, end: number) => spread(tokens, start, end);

type CaptionSource = { text?: string; words?: CaptionWord[]; inPoint: number; outPoint: number };

/** Provided timings when they still match the text, otherwise an estimate over the visible range. */
export function captionWordTimeline(clip: CaptionSource, displayText = clip.text ?? '') {
  const tokens = tokenizeCaption(displayText);
  const provided = clip.words && clip.words.length === tokens.length &&
    clip.words.every((word, index) => normalize(word.text) === normalize(tokens[index].text)) ? clip.words : null;
  return { tokens, words: provided ?? estimateCaptionWords(tokens, clip.inPoint, clip.outPoint), measured: Boolean(provided) };
}

/** The most recently started word stays lit until the next one starts. */
export function activeCaptionWordIndex(words: readonly CaptionWord[], sourceTime: number) {
  let active = -1;
  for (const [index, word] of words.entries()) {
    if (word.start <= sourceTime + 1e-6) active = index;
    else break;
  }
  return active;
}

export function validateCaptionWords(words: readonly CaptionWord[], sourceDuration: number) {
  let previous = 0;
  for (const word of words) {
    if (word.end < word.start || word.start < previous - 0.001 || word.end > sourceDuration + 0.001) return false;
    previous = word.end;
  }
  return true;
}

/**
 * Keep the timing of unchanged words after a text edit. Replaced words take the
 * replaced span; inserted words share the surrounding gap, borrowing half of a
 * neighbour when the gap is too short. Returns null when nothing can be kept.
 */
export function retimeCaptionWords(previous: readonly CaptionWord[], nextText: string, start: number, end: number): CaptionWord[] | null {
  const tokens = tokenizeCaption(nextText);
  if (!tokens.length || !previous.length) return null;
  const a = previous.map((word) => normalize(word.text));
  const b = tokens.map((token) => normalize(token.text));
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) {
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  if (!table[0][0]) return null;
  const result: (CaptionWord | null)[] = new Array(tokens.length).fill(null);
  const blocks: { removed: number[]; added: number[] }[] = [];
  let block = { removed: [] as number[], added: [] as number[] };
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      if (block.removed.length || block.added.length) blocks.push(block);
      block = { removed: [], added: [] };
      result[j] = { text: tokens[j].text, start: previous[i].start, end: previous[i].end };
      i += 1; j += 1;
    } else if (j < b.length && (i >= a.length || table[i][j + 1] >= table[i + 1][j])) {
      block.added.push(j); j += 1;
    } else {
      block.removed.push(i); i += 1;
    }
  }
  if (block.removed.length || block.added.length) blocks.push(block);
  for (const { removed, added } of blocks) {
    if (!added.length) continue;
    const before = added[0] > 0 ? result[added[0] - 1] : null;
    const after = added[added.length - 1] + 1 < tokens.length ? result[added[added.length - 1] + 1] : null;
    let lo = removed.length ? previous[removed[0]].start : (before?.end ?? start);
    let hi = removed.length ? previous[removed[removed.length - 1]].end : (after?.start ?? end);
    if (hi - lo < 0.08 * added.length) {
      if (before && before.end - before.start > 0.1) { lo = before.start + (before.end - before.start) / 2; before.end = round(lo); }
      else if (after && after.end - after.start > 0.1) { hi = after.start + (after.end - after.start) / 2; after.start = round(hi); }
    }
    spread(added.map((index) => tokens[index]), lo, Math.max(lo, hi)).forEach((word, offset) => { result[added[offset]] = word; });
  }
  let cursor = start;
  return result.map((word, index) => {
    const from = Math.min(end, Math.max(cursor, word?.start ?? cursor));
    const to = Math.min(end, Math.max(from, word?.end ?? from));
    cursor = to;
    return { text: tokens[index].text, start: round(from), end: round(to) };
  });
}

export type TimedWord = CaptionWord;

type EditedCaption = { text?: string; words?: CaptionWord[]; inPoint: number; outPoint: number; duration: number };

/** Words for a rewritten cue: shifted to its new source range, rescaled to its length, re-timed when the text changed. */
export function captionWordsAfterEdit(existing: EditedCaption | undefined, next: EditedCaption): CaptionWord[] | undefined {
  if (!existing?.words?.length) return undefined;
  const scale = next.duration / Math.max(0.001, existing.outPoint - existing.inPoint);
  const moved = existing.words.map((word) => ({
    text: word.text,
    start: round(Math.min(next.duration, Math.max(0, (word.start - existing.inPoint) * scale))),
    end: round(Math.min(next.duration, Math.max(0, (word.end - existing.inPoint) * scale))),
  }));
  if ((existing.text ?? '') === (next.text ?? '')) return moved;
  return retimeCaptionWords(moved, next.text ?? '', 0, next.duration) ?? undefined;
}

/** Group absolute word timings (for example from a voice provider) into readable cues with relative word timings. */
export function captionCuesFromWords(words: readonly TimedWord[], { maxWords = 6, maxSeconds = 3.2, maxCharacters = 32 } = {}) {
  const atoms: TimedWord[] = [];
  for (const word of words) {
    const parts = tokenizeCaption(word.text.trim());
    if (!parts.length) continue;
    if (PUNCTUATION.test(word.text.trim()) && atoms.length) {
      atoms[atoms.length - 1] = { ...atoms[atoms.length - 1], text: atoms[atoms.length - 1].text + word.text.trim(), end: Math.max(atoms[atoms.length - 1].end, word.end) };
    } else atoms.push(...(parts.length === 1 ? [{ text: parts[0].text, start: word.start, end: word.end }] : spread(parts, word.start, word.end)));
  }
  const groups: { words: TimedWord[]; forced: boolean }[] = [];
  let current: TimedWord[] = [];
  const flush = (forced: boolean) => {
    if (current.length) groups.push({ words: current, forced });
    current = [];
  };
  for (const word of atoms) {
    const previous = current[current.length - 1];
    const characters = current.reduce((sum, item) => sum + item.text.length + 1, 0) + word.text.length;
    const natural = Boolean(previous) && (/[.!?。！？…]$/.test(previous.text) || word.start - previous.end > 0.6);
    if (previous && (natural || current.length >= maxWords || word.end - current[0].start > maxSeconds || characters > maxCharacters)) flush(!natural);
    current.push(word);
  }
  flush(false);
  // A limit that leaves one word alone at the end of a phrase takes a word from the cue before instead.
  for (let index = 1; index < groups.length; index += 1) {
    const before = groups[index - 1], orphan = groups[index];
    if (before.forced && orphan.words.length === 1 && before.words.length >= 3) orphan.words.unshift(before.words.pop()!);
  }
  return groups.map(({ words: group }) => {
    const startTime = group[0].start, endTime = Math.max(group[group.length - 1].end, startTime + 0.04);
    const tokens = group.map((word, index) => ({ text: word.text, leading: (index && !(IDEOGRAPHIC.test(word.text) && IDEOGRAPHIC.test(group[index - 1].text)) ? ' ' : '') as CaptionToken['leading'] }));
    return { startTime: round(startTime), endTime: round(endTime), text: joinCaptionTokens(tokens), words: group.map((word) => ({ text: word.text, start: round(word.start - startTime), end: round(word.end - startTime) })) };
  });
}
