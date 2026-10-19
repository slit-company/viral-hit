import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkTimeline, parseDocument } from './input.mjs';
import { runProcess } from './process.mjs';

export const MEDIA_SLOTS = ['image', 'video', 'audio'].flatMap(kind => [1, 2].map(index => ({
  id: `${kind}-${index}`, kind, maxBytes: (kind === 'video' ? 64 : 32) * 1024 * 1024,
})));

export function checkMediaInput(input) {
  const document = parseDocument(JSON.stringify(input.timeline));
  if (!input.assets || Array.isArray(input.assets) || typeof input.assets !== 'object' ||
    Object.keys(input.assets).length !== MEDIA_SLOTS.length) throw Error('Declare all six media slots; use null for unused slots');
  for (const slot of MEDIA_SLOTS) {
    const id = input.assets[slot.id];
    if (id !== null && (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) throw Error(`Invalid asset slot: ${slot.id}`);
  }
  const inspection = structuredClone(document);
  let count = 0;
  for (const [id, source] of Object.entries(document.sources ?? {})) {
    if (source?.type === 'color') continue;
    const slot = MEDIA_SLOTS.find(slot => source?.path === `asset:${slot.id}`);
    if (!slot || slot.kind !== source.type || input.assets[slot.id] === null) throw Error(`Source ${id} needs a selected ${source?.type ?? 'media'} asset slot`);
    if (Object.keys(source).some(key => !['type', 'path', ...(source.type === 'video' ? ['muted'] : [])].includes(key))) throw Error(`Unsupported fields on source ${id}`);
    // The ordinary bridge still rejects resource paths everywhere else in the document.
    inspection.sources[id] = { type: 'color', color: '#000000' };
    count++;
  }
  if (!count) throw Error('A media composition must use at least one selected project asset');
  for (const cue of inspection.audio?.cues ?? []) {
    const source = document.sources?.[cue.sfx];
    if (source && ['audio', 'video'].includes(source.type)) cue.sfx = 'preset:click';
  }
  checkTimeline(inspection);
  return document;
}

function suffix(bytes, kind) {
  if (kind === 'image') {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
    if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  } else if (kind === 'video') {
    if (bytes.subarray(4, 8).toString() === 'ftyp') return 'mp4';
    if (bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))) return 'webm';
  } else {
    if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE') return 'wav';
    if (bytes.subarray(0, 4).toString() === 'fLaC') return 'flac';
    if (bytes.subarray(0, 4).toString() === 'OggS') return 'ogg';
    if (bytes.subarray(4, 8).toString() === 'ftyp') return 'm4a';
    if (bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224)) return 'mp3';
  }
  throw Error(`Unsupported ${kind} container; playlists, URLs and SVG are not file media inputs`);
}

function checkProbe(probe, kind) {
  const streams = probe.streams;
  if (!Array.isArray(streams) || streams.length > 8) throw Error('Invalid input media streams');
  const stream = streams.find(stream => stream.codec_type === (kind === 'audio' ? 'audio' : 'video'));
  if (!stream) throw Error(`Input has no ${kind} stream`);
  if (kind !== 'audio' && (!Number.isInteger(stream.width) || !Number.isInteger(stream.height) ||
    stream.width < 1 || stream.height < 1 || stream.width * stream.height > 16_777_216)) throw Error('Source exceeds the 16-megapixel input limit');
  if (kind !== 'image' && !(Number(probe.format?.duration) > 0 && Number(probe.format.duration) <= 3600)) throw Error('Source duration must be at most one hour');
  if (kind === 'audio' && !(stream.channels > 0 && stream.channels <= 8)) throw Error('Source audio must have 1–8 channels');
}

export async function stageMedia(document, input, context, work, options) {
  const result = structuredClone(document), paths = new Map();
  for (const source of Object.values(result.sources ?? {})) {
    if (source.type === 'color') continue;
    const slot = MEDIA_SLOTS.find(slot => source.path === `asset:${slot.id}`);
    if (!slot || input.assets[slot.id] === null) throw Error('Unbound media source');
    if (!paths.has(slot.id)) {
      const asset = await context.readAsset(slot.id);
      if (asset.kind !== slot.kind || asset.bytes.length < 12 || asset.bytes.length > slot.maxBytes) throw Error(`Invalid media bytes for ${slot.id}`);
      const bytes = Buffer.from(asset.bytes);
      const file = join(work, `${slot.id}.${suffix(bytes, slot.kind)}`);
      await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
      const output = await runProcess(options.env.VID2_FFPROBE, [
        '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', file,
      ], { ...options, timeoutMs: 5000, maxBytes: 65536 });
      checkProbe(JSON.parse(output), slot.kind);
      paths.set(slot.id, file);
    }
    source.path = paths.get(slot.id);
  }
  return result;
}
