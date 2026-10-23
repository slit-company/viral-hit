import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);

/** Uses input.references roles: the subject is centered, the style becomes a blurred background. Not a generative model. */
export async function createGeneration({ input, signal, readMedia }) {
  const references = input.references ?? [];
  const subject = references.find(entry => entry.role === 'subject'), style = references.find(entry => entry.role === 'style');
  if (!readMedia || !subject) throw Error('Mark one image as the subject');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const directory = await mkdtemp(join(tmpdir(), 'viral-hit-role-collage-'));
  const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
  const guard = ['-protocol_whitelist', 'file', '-format_whitelist', 'png_pipe,jpeg_pipe,webp_pipe,image2'];
  async function local(url, name) {
    const media = await readMedia(url);
    if (media.kind !== 'image') throw Error('Subject and style must be images');
    const path = join(directory, name); await writeFile(path, media.bytes); return path;
  }
  try {
    const args = ['-v', 'error', '-nostdin', '-threads', '2'];
    let filter;
    if (style) {
      args.push(...guard, '-i', await local(style.url, 'style'), ...guard, '-i', await local(subject.url, 'subject'));
      filter = '[0:v:0]scale=512:512:force_original_aspect_ratio=increase,crop=512:512,gblur=sigma=12[bg];[1:v:0]scale=320:320:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[out]';
    } else {
      args.push('-f', 'lavfi', '-i', 'color=0x808080:s=512x512', ...guard, '-i', await local(subject.url, 'subject'));
      filter = '[1:v:0]scale=320:320:force_original_aspect_ratio=decrease[fg];[0:v:0][fg]overlay=(W-w)/2:(H-h)/2[out]';
    }
    const destination = join(directory, 'output.png');
    args.push('-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-c:v', 'png', destination);
    await execute(ffmpeg, args, { signal: bounded, timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    return { status: 'succeeded', media: [{ data: new Uint8Array(await readFile(destination)), mimeType: 'image/png' }] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

