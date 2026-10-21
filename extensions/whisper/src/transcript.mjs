const round = value => Math.round(value * 1000) / 1000;
export function normalizeTranscript(raw, { source, start, duration, engine }) {
  if (!Array.isArray(raw.transcription) || raw.transcription.length > 120 || !/^[a-z]{2,3}$/.test(raw.result?.language ?? '')) throw Error('Whisper returned an invalid or oversized transcript');
  const segments = []; let adjusted = 0, omitted = 0, previous = 0;
  for (const item of raw.transcription) {
    const from = item.offsets?.from, to = item.offsets?.to;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || typeof item.text !== 'string' || item.text.length > 4000) throw Error('Whisper returned invalid segment timing or text');
    const text = item.text.trim().replace(/[\r\n\t]+/g, ' ');
    const left = Math.max(previous, from / 1000), right = Math.min(duration, to / 1000);
    if (!text || right - left < .01) { omitted++; continue; }
    if (left !== from / 1000 || right !== to / 1000) adjusted++;
    segments.push({ start: round(start + left), end: round(start + right), text }); previous = right;
  }
  const { bytes: _, mimeType: __, filename: ___, ...pin } = source;
  const transcript = { schemaVersion: 1, basis: 'machine-transcription', source: pin, engine, language: raw.result.language,
    range: { start: round(start), end: round(start + duration) }, segments, timingAdjusted: adjusted, segmentsOmitted: omitted };
  return { transcript,
    mediaClips: [{ id: 'spoken-source', type: 'media', source: 'source', startTime: 0, duration: round(duration), inPoint: start, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 }],
    captionClips: segments.map((segment, index) => ({ id: 'speech-' + (index + 1), type: 'caption', text: segment.text, startTime: round(segment.start - start), duration: round(segment.end - segment.start) })),
    duration: round(duration),
  };
}
