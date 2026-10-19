// Bridge limits are intentionally narrower than the upstream authoring formats.
export function parseDocument(text) {
  if (typeof text !== 'string' || text.length > 16000) throw new Error('Document must be JSON text up to 16,000 characters');
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  let nodes = 0;
  function visit(item, depth = 0) {
    if (++nodes > 4000 || depth > 24) throw new Error('Document complexity exceeds the local bridge limit');
    if (typeof item === 'number' && (!Number.isFinite(item) || Math.abs(item) > 1_000_000)) throw new Error('Number exceeds the local bridge limit');
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsupported document key');
      visit(child, depth + 1);
    }
  }
  visit(value);
  return value;
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { visit(key, child); walk(child, visit); }
}
function bounded(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be ${min}–${max}`);
  return value;
}

export function checkSong(song) {
  if (song.version !== 1 || !Array.isArray(song.tracks) || !Array.isArray(song.sections) || !Array.isArray(song.arrangement)) throw new Error('Expected a music2 Song v1');
  if (song.tracks.length > 16 || song.sections.length > 32 || song.arrangement.length > 32) throw new Error('Song exceeds 16 tracks or 32 sections/arrangement entries');
  if (song.audioTracks !== undefined) throw new Error('External audio tracks require a project-media bridge');
  walk(song, (key, value) => {
    if (['plugins', 'file', 'path'].includes(key)) throw new Error('External files/plugins are not enabled in the local music bridge');
    if (key === 'instrument' && (typeof value !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(value))) throw new Error('Use a built-in synthesized instrument; sampled instruments need an explicit media bridge');
  });
  const bpm = bounded(song.bpm, 40, 240, 'BPM');
  const meter = bounded(song.meter?.numerator ?? 4, 2, 12, 'Meter');
  const tail = bounded(song.tailSeconds ?? 2, 0, 10, 'Tail');
  const sections = new Map(song.sections.map(section => [section.id, bounded(section.bars, 1, 64, 'Section bars')]));
  let bars = 0;
  for (const part of song.arrangement) {
    if (!sections.has(part.section)) throw new Error('Unknown arrangement section');
    bars += sections.get(part.section) * bounded(part.repeats ?? 1, 1, 32, 'Repeats');
  }
  bounded(bars * meter * 60 / bpm + (song.loop ? 0 : tail), 0.1, 60, 'Song duration in seconds');
  return song;
}

export function checkTimeline(timeline) {
  if (timeline.version !== 1 || !Array.isArray(timeline.scenes) || timeline.scenes.length < 1 || timeline.scenes.length > 24) throw new Error('Expected a vid2 Timeline v1 with 1–24 scenes');
  const output = timeline.output ?? {};
  bounded(output.width ?? 1920, 16, 1920, 'Width');
  bounded(output.height ?? 1080, 16, 1920, 'Height');
  if ((output.width ?? 1920) * (output.height ?? 1080) > 2073600) throw new Error('Output exceeds 1080p pixel budget');
  bounded(output.fps ?? 30, 1, 60, 'FPS');
  if ((output.container ?? 'mp4') !== 'mp4' || (output.videoCodec ?? 'h264') !== 'h264') throw new Error('The bridge exports H.264 MP4');
  for (const source of Object.values(timeline.sources ?? {})) if (source?.type !== 'color') throw new Error('This bridge supports color sources; file/generated/capture sources need explicit media bindings');
  if (Object.keys(timeline.fonts ?? {}).length) throw new Error('Custom fonts need explicit media bindings; use sans, serif or mono');
  walk(timeline, (key, value) => {
    if (['path', 'file', 'url', 'session', 'provider', 'tts', 'map', 'lut'].includes(key)) throw new Error(`External resource ${key} is not enabled in the local video bridge`);
    if (key === 'font' && !['sans', 'serif', 'mono'].includes(value)) throw new Error('Use a bundled font: sans, serif or mono');
    if (key === 'sfx' && (typeof value !== 'string' || !/^preset:[a-z0-9_-]+$/.test(value))) throw new Error('Only built-in SFX presets are enabled');
  });
  if (timeline.scenes.some(scene => (scene.layers?.length ?? 0) > 24)) throw new Error('A scene exceeds 24 layers');
  return timeline;
}

export function checkValidation(engine, response, document) {
  if (engine === 'music') {
    const data = response?.data;
    bounded((data?.durationSeconds ?? NaN) + (document.loop ? 0 : (document.tailSeconds ?? 2)), 0.1, 60, 'Resolved song duration');
    if (!Array.isArray(data.tracks)) throw new Error('Missing validated music tracks');
    let events = 0;
    for (const track of data.tracks) events += bounded(track.events, 0, 10000, 'Track events');
    bounded(events, 1, 20000, 'Total events');
  } else {
    bounded(response?.data?.summary?.totalSeconds, 0.1, 60, 'Resolved video duration');
    bounded(response?.data?.summary?.totalFrames, 1, 3600, 'Resolved frames');
  }
}
