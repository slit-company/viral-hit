import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export type MediaKind = 'image' | 'video' | 'audio';
export type MediaInfo = { kind: MediaKind; mimeType: string; extension: string; width: number | null; height: number | null; durationMs: number | null; hasAudio: boolean };
export async function probeMedia(file: string, kind: MediaKind, signal: AbortSignal): Promise<MediaInfo> {
  const { stdout } = await execute(process.env.VIRAL_HIT_FFPROBE || 'ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'png_pipe,jpeg_pipe,webp_pipe,gif,image2,mov,matroska,mp3,wav,ogg', '-show_streams', '-show_format', '-of', 'json', file,
  ], { signal, timeout: 15_000, maxBuffer: 1024 * 1024 });
  const data = JSON.parse(stdout);
  const streams = data.streams as { codec_type: string; codec_name: string; width?: number; height?: number; disposition?: { attached_pic?: number } }[];
  if (!Array.isArray(streams)) throw new Error('Media has no decodable streams');
  const visual = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.find(s => s.codec_type === 'audio');
  const format = String(data.format?.format_name ?? '').split(',');
  const still: Record<string, [string, string]> = { png: ['image/png', 'png'], mjpeg: ['image/jpeg', 'jpg'], webp: ['image/webp', 'webp'], gif: ['image/gif', 'gif'] };
  let mimeType: string, extension: string, durationMs: number | null = null;
  if (kind === 'image') {
    if (!visual || !still[visual.codec_name] || audio || !format.some(f => ['png_pipe', 'jpeg_pipe', 'webp_pipe', 'gif', 'image2'].includes(f))) throw new Error('Expected a supported raster image');
    [mimeType, extension] = still[visual.codec_name];
  } else {
    if (kind === 'video' ? !visual : !audio || Boolean(visual)) throw new Error(`Expected ${kind} media`);
    durationMs = Math.round(Number(data.format?.duration) * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 24 * 60 * 60 * 1000) throw new Error('Media duration is invalid');
    if (format.includes('mp4') || format.includes('mov')) { mimeType = kind === 'video' ? 'video/mp4' : 'audio/mp4'; extension = kind === 'video' ? 'mp4' : 'm4a'; }
    else if (format.includes('webm') || format.includes('matroska')) { mimeType = `${kind}/webm`; extension = 'webm'; }
    else if (kind === 'audio' && format.includes('mp3')) { mimeType = 'audio/mpeg'; extension = 'mp3'; }
    else if (kind === 'audio' && format.includes('wav')) { mimeType = 'audio/wav'; extension = 'wav'; }
    else if (kind === 'audio' && format.includes('ogg')) { mimeType = 'audio/ogg'; extension = 'ogg'; }
    else throw new Error('Unsupported media container');
  }
  if (visual && (!(visual.width! > 0) || !(visual.height! > 0) || visual.width! * visual.height! > 100_000_000)) throw new Error('Media dimensions are invalid');
  return { kind, mimeType, extension, width: visual?.width ?? null, height: visual?.height ?? null, durationMs, hasAudio: Boolean(audio) };
}
