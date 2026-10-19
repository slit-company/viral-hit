import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { InstagramMetadata } from './instagram-contract';

const numeric = z.coerce.number().finite();
const stream = z.object({
  codec_type: z.string(), codec_name: z.string().optional(), width: numeric.optional(), height: numeric.optional(),
  pix_fmt: z.string().optional(), field_order: z.string().optional(), avg_frame_rate: z.string().optional(),
  sample_rate: numeric.optional(), channels: numeric.optional(), bit_rate: numeric.optional(),
  disposition: z.object({ attached_pic: z.number().optional() }).optional(),
});
const probeSchema = z.object({ format: z.object({ duration: numeric.positive(), format_name: z.string() }), streams: z.array(stream).max(32) });
export type PublicationVideoProbe = z.infer<typeof probeSchema>;
export class InstagramVideoError extends Error {}

/** Inherited, already verified local descriptor. No user path, network protocol or shell invocation. */
export async function probePublicationVideo(fd: number, parent: AbortSignal): Promise<PublicationVideoProbe> {
  parent.throwIfAborted();
  const signal = AbortSignal.any([parent, AbortSignal.timeout(30000)]);
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.VIRAL_HIT_FFPROBE || 'ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'file', '-show_entries',
      'format=duration,format_name:stream=codec_type,codec_name,width,height,pix_fmt,field_order,avg_frame_rate,sample_rate,channels,bit_rate:stream_disposition=attached_pic',
      '-of', 'json', '/dev/fd/3',
    ], { stdio: ['ignore', 'pipe', 'ignore', fd], signal });
    const parts: Buffer[] = []; let length = 0, failure: Error | undefined;
    child.stdout!.on('data', (part: Buffer) => {
      length += part.length;
      if (length > 65536) { failure = new Error('Probe output limit'); child.kill('SIGKILL'); }
      else parts.push(part);
    });
    child.once('error', error => { failure = error; });
    child.once('close', code => {
      if (failure || code !== 0 || signal.aborted) reject(new InstagramVideoError('The retained MP4 could not be inspected. Check FFprobe and export a valid video.'));
      else resolve(Buffer.concat(parts).toString('utf8'));
    });
  });
  try { return probeSchema.parse(JSON.parse(stdout)); }
  catch { throw new InstagramVideoError('The retained video has no supported duration or stream information.'); }
}
/** Measurable admission checks. Meta remains authoritative for closed GOP/VBR and container compatibility. */
export function validateInstagramVideo(probe: PublicationVideoProbe, bytes: number, metadata: InstagramMetadata) {
  const fail = (message: string): never => { throw new InstagramVideoError(message); };
  const story = metadata.kind === 'story', limit = story ? 60 : 900;
  if (!probe.format.format_name.split(',').includes('mp4')) fail('Instagram requires an MP4 container.');
  if (probe.format.duration < 3 || probe.format.duration > limit) fail(`Instagram ${story ? 'Stories require 3–60' : 'Reels require 3–900'} seconds of video.`);
  if (bytes > (story ? 100 : 300) * 1000000) fail(`Instagram ${story ? 'Stories are limited to 100' : 'Reels are limited to 300'} MB.`);
  const videos = probe.streams.filter(item => item.codec_type === 'video'), audio = probe.streams.filter(item => item.codec_type === 'audio');
  if (videos.length !== 1 || audio.length > 1 || probe.streams.length !== videos.length + audio.length) fail('Export one video stream and at most one audio stream.');
  const video = videos[0];
  if (video.disposition?.attached_pic || !['h264', 'hevc'].includes(video.codec_name ?? '') || !['yuv420p', 'yuv420p10le'].includes(video.pix_fmt ?? '')) fail('Export H.264 or HEVC video with 4:2:0 chroma subsampling.');
  if (!['progressive', 'unknown', undefined].includes(video.field_order)) fail('Export progressive video for Instagram.');
  const [numerator, denominator] = (video.avg_frame_rate ?? '').split('/').map(Number), fps = numerator / denominator;
  if (!Number.isFinite(fps) || fps < 23 || fps > 60) fail('Instagram requires a frame rate between 23 and 60 FPS.');
  const width = video.width ?? 0, height = video.height ?? 0, aspect = width / height;
  if (width < 1 || width > 1920 || height < 1 || aspect < (story ? 0.1 : 0.01) || aspect > 10) fail('Export a video up to 1920 pixels wide with an Instagram-compatible aspect ratio; 9:16 is recommended.');
  if (video.bit_rate !== undefined && video.bit_rate > 25000000) fail('Export video at no more than 25 Mbps.');
  if (audio.some(item => item.codec_name !== 'aac' || !item.sample_rate || item.sample_rate > 48000 || ![1, 2].includes(item.channels ?? 0))) fail('Use AAC audio, mono or stereo, at no more than 48 kHz.');
}
