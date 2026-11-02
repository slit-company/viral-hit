import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { INSTAGRAM_IMAGE_MAX_BYTES, type InstagramImagePlan } from './instagram-frame';

export class InstagramImageError extends Error {}
const probeSchema = z.object({ streams: z.array(z.object({ codec_type: z.string(), width: z.coerce.number().int().positive(), height: z.coerce.number().int().positive() })).min(1) });

/** Fixed argument vectors only: no shell, no network protocols, bounded output and time. */
function run(binary: string, args: string[], parent: AbortSignal) {
  parent.throwIfAborted();
  const signal = AbortSignal.any([parent, AbortSignal.timeout(60000)]);
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'ignore'], signal });
    const parts: Buffer[] = []; let size = 0, failure: Error | undefined;
    child.stdout!.on('data', (part: Buffer) => { size += part.length; if (size > 65536) { failure = new Error('Output limit'); child.kill('SIGKILL'); } else parts.push(part); });
    child.once('error', error => { failure = error; });
    child.once('close', code => failure || code !== 0 || signal.aborted ? reject(failure ?? new Error('Image tool failed')) : resolve(Buffer.concat(parts).toString('utf8')));
  });
}
const ffprobe = () => process.env.VIRAL_HIT_FFPROBE || 'ffprobe', ffmpeg = () => process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';

/** Reads only a private verified copy. Animated files contribute their first frame. */
export async function probeInstagramImage(file: string, signal: AbortSignal) {
  try {
    const raw = await run(ffprobe(), ['-v', 'error', '-protocol_whitelist', 'file', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', file], signal);
    const stream = probeSchema.parse(JSON.parse(raw)).streams[0];
    if (stream.codec_type !== 'video' || stream.width < 2 || stream.height < 2 || stream.width > 20000 || stream.height > 20000) throw new Error('Unsupported image');
    return { width: stream.width, height: stream.height };
  } catch { throw new InstagramImageError('This image could not be read. Use a PNG, JPEG or WebP image.'); }
}

function filterGraph(plan: InstagramImagePlan) {
  const { width: w, height: h } = plan, size = `${w}x${h}`;
  if (plan.frame === 'fill') {
    const crop = plan.crop ? `crop=${plan.crop.width}:${plan.crop.height}:${plan.crop.x}:${plan.crop.y},` : '';
    return `[0:v]${crop}scale=${w}:${h}:flags=lanczos,format=rgba[img];color=c=white:s=${size},format=rgba[base];[base][img]overlay=shortest=1:format=auto,format=yuvj420p[out]`;
  }
  const sigma = Math.max(12, Math.round(Math.max(w, h) / 40));
  return [
    '[0:v]format=rgba,split=2[cover][fit]',
    `color=c=white:s=${size},format=rgba[base]`,
    `[cover]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h}[wide]`,
    `[base][wide]overlay=shortest=1:format=auto,format=gbrp,gblur=sigma=${sigma},eq=brightness=-0.05[back]`,
    `[fit]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[front]`,
    '[back][front]overlay=(W-w)/2:(H-h)/2:format=auto,format=yuvj420p[out]',
  ].join(';');
}

/** Baseline JPEG in sRGB-compatible full-range YUV, metadata removed, within Meta's 8 MB limit. */
export async function renderInstagramJpeg(input: string, output: string, plan: InstagramImagePlan, signal: AbortSignal) {
  for (const quality of [2, 4, 7]) {
    try {
      await run(ffmpeg(), ['-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file', '-i', input, '-filter_complex', filterGraph(plan), '-map', '[out]',
        '-frames:v', '1', '-map_metadata', '-1', '-c:v', 'mjpeg', '-q:v', String(quality), '-f', 'image2', '-update', '1', output], signal);
    } catch { throw new InstagramImageError('This image could not be converted to an Instagram JPEG.'); }
    const written = await probeInstagramImage(output, signal);
    if (written.width !== plan.width || written.height !== plan.height) throw new InstagramImageError('The converted image has unexpected dimensions.');
    if ((await stat(output)).size <= INSTAGRAM_IMAGE_MAX_BYTES) return;
  }
  throw new InstagramImageError('This image stays above Instagram\'s 8 MB limit after conversion.');
}
