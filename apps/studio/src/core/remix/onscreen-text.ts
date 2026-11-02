/** A text box in a frame, as fractions of the frame (x, y is the top-left corner). */
export type TextBox = { x: number; y: number; width: number; height: number };
export type TextBlock = { text: string; box: TextBox; confidence: number; lines: number };
export type TextSegment = { start: number; end: number; text: string; box: TextBox; confidence: number; lines: number };

const round = (value: number) => Math.round(value * 1000) / 1000 + 0;
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const meaningful = (text: string) => normalize(text).replace(/ /g, '').length >= 2;
// OCR often reads a box edge or shadow as a quote or bracket at a word's edge.
const clean = (word: string) => word.replace(/^[^\p{L}\p{N}#@$€£¥"]+|[^\p{L}\p{N}!?.%)"]+$/gu, '').replace(/^\)+|\)+$/g, '');

/**
 * Tesseract TSV words grouped into lines, then into blocks. Words below 75% confidence and lines without at
 * least two letters or digits are dropped: clean captions read above 90%, texture mistaken for text below 70%.
 */
export function parseTesseractTsv(tsv: string, width: number, height: number, minConfidence = 75): TextBlock[] {
  const lines = new Map<string, { words: string[]; conf: number[]; left: number; top: number; right: number; bottom: number; block: string }>();
  for (const row of tsv.split('\n').slice(1)) {
    const cells = row.split('\t');
    if (cells.length < 12 || cells[0] !== '5') continue;
    const [, , block, paragraph, line, , left, top, w, h, conf] = cells.map(Number), word = clean(cells.slice(11).join('\t').trim());
    // A word covering a third of the frame is texture, not text.
    if (!word || !(conf >= minConfidence) || ![left, top, w, h].every(Number.isFinite) || h > height * 0.3 || w > width * 0.95) continue;
    const key = `${block}-${paragraph}-${line}`, entry = lines.get(key) ?? { words: [], conf: [], left, top, right: left + w, bottom: top + h, block: String(block) };
    entry.words.push(word); entry.conf.push(conf);
    entry.left = Math.min(entry.left, left); entry.top = Math.min(entry.top, top); entry.right = Math.max(entry.right, left + w); entry.bottom = Math.max(entry.bottom, top + h);
    lines.set(key, entry);
  }
  const blocks = new Map<string, { texts: string[]; conf: number[]; left: number; top: number; right: number; bottom: number }>();
  for (const line of lines.values()) {
    const text = line.words.join(' ');
    if (!meaningful(text)) continue;
    const entry = blocks.get(line.block) ?? { texts: [], conf: [], left: line.left, top: line.top, right: line.right, bottom: line.bottom };
    entry.texts.push(text); entry.conf.push(...line.conf);
    entry.left = Math.min(entry.left, line.left); entry.top = Math.min(entry.top, line.top); entry.right = Math.max(entry.right, line.right); entry.bottom = Math.max(entry.bottom, line.bottom);
    blocks.set(line.block, entry);
  }
  return [...blocks.values()].map(block => ({
    text: block.texts.join('\n').slice(0, 500), lines: block.texts.length,
    confidence: Math.round(block.conf.reduce((sum, value) => sum + value, 0) / block.conf.length),
    box: { x: round(block.left / width), y: round(block.top / height), width: round((block.right - block.left) / width), height: round((block.bottom - block.top) / height) },
  })).sort((a, b) => a.box.y - b.box.y);
}

const overlap = (a: TextBox, b: TextBox) => {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? (width * height) / Math.min(a.width * a.height, b.width * b.height) : 0;
};
/** Readings of the same frame from different preprocessing; where they overlap, the more confident one wins. */
export function mergeTextBlocks(...readings: TextBlock[][]): TextBlock[] {
  const merged: TextBlock[] = [];
  for (const block of readings.flat().sort((a, b) => b.confidence - a.confidence)) if (!merged.some(other => overlap(other.box, block.box) > 0.4)) merged.push(block);
  return merged.sort((a, b) => a.box.y - b.box.y);
}

function similar(a: string, b: string) {
  const left = normalize(a), right = normalize(b);
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right, longer = left.length < right.length ? right : left;
  // Callers also require the same place on screen, so a partial reading of the same caption is the same text.
  return shorter.length >= 3 && longer.includes(shorter);
}
const near = (a: TextBox, b: TextBox) => Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 0.12 && Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 0.08;

/**
 * Text seen in consecutive samples at the same place becomes one segment that lasts until it disappears.
 * Small text present for almost the whole video (a watermark or handle) is not part of the edit and is dropped.
 */
export function trackTextSegments(frames: readonly { time: number; blocks: TextBlock[] }[], interval: number, duration: number): TextSegment[] {
  const done: TextSegment[] = [];
  let open: (TextSegment & { seen: number })[] = [];
  for (const frame of frames) {
    const next: typeof open = [];
    for (const block of frame.blocks) {
      const match = open.find(segment => similar(segment.text, block.text) && near(segment.box, block.box));
      if (match) {
        open = open.filter(segment => segment !== match);
        // Keep the most confident reading of the same text.
        next.push({ ...(block.confidence > match.confidence ? { ...match, text: block.text, box: block.box, confidence: block.confidence, lines: block.lines } : match), end: round(Math.min(duration, frame.time + interval)), seen: match.seen + 1 });
      } else next.push({ ...block, start: round(frame.time), end: round(Math.min(duration, frame.time + interval)), seen: 1 });
    }
    done.push(...open.map(({ seen: _, ...segment }) => segment));
    open = next;
  }
  done.push(...open.map(({ seen: _, ...segment }) => segment));
  return done.filter(segment => !(segment.end - segment.start >= duration * 0.9 && segment.box.height < 0.04))
    .sort((a, b) => a.start - b.start || a.box.y - b.box.y).slice(0, 200);
}
