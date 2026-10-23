import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);

const EFFECTS = new Set(['blur', 'grayscale', 'pixelate', 'fill']);
const COLORS = { white: 'white', black: 'black', gray: '0x808080' };

function edit(effect, strength, color, width, height) {
  if (effect === 'blur') return `gblur=sigma=${strength}`;
  if (effect === 'grayscale') return 'hue=s=0';
  if (effect === 'pixelate') {
    const w = Math.max(1, Math.round(width / strength)), h = Math.max(1, Math.round(height / strength));
    return `scale=${w}:${h}:flags=neighbor,scale=${width}:${height}:flags=neighbor`;
  }
  return `drawbox=x=0:y=0:w=iw:h=ih:color=${COLORS[color]}:t=fill`;
}

/** Changes only where the mask is white; black keeps the original pixels. Not a generative model. */
export async function createGeneration({ input, signal, readMedia }) {
  if (!readMedia || input.imageUrls?.length !== 1 || !input.maskUrl) throw Error('Choose one local image and a mask');
  const { effect = 'blur', strength = 16, color = 'white' } = input.options ?? {};
  if (!EFFECTS.has(effect) || !COLORS[color] || !Number.isInteger(strength) || strength < 1 || strength > 50) throw Error('Invalid edit controls');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const directory = await mkdtemp(join(tmpdir(), 'viral-hit-masked-edit-'));
  const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ffprobe = process.env.VIRAL_HIT_FFPROBE || 'ffprobe';
  const guard = ['-protocol_whitelist', 'file', '-format_whitelist', 'png_pipe,jpeg_pipe,webp_pipe,image2'];
  async function local(url, name) {
    const source = await readMedia(url);
    if (source.kind !== 'image') throw Error('Source and mask must be images');
    const path = join(directory, name); await writeFile(path, source.bytes); return path;
  }
  try {
    const image = await local(input.imageUrls[0], 'source'), mask = await local(input.maskUrl, 'mask');
    const { stdout } = await execute(ffprobe, ['-v', 'error', ...guard, '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', image],
      { signal: bounded, timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' });
    const { width, height } = JSON.parse(stdout).streams?.[0] ?? {};
    if (!width || !height || width * height > 4096 * 4096) throw Error('Source dimensions exceed this processor limit');
    // The mask is stretched to the source size, so a mask drawn at a preview resolution still lines up.
    const filter = `[0:v:0]format=gbrp,split[keep][work];[work]${edit(effect, strength, color, width, height)},format=gbrp[changed];`
      + `[1:v:0]scale=${width}:${height},format=gray,format=gbrp[mask];[keep][changed][mask]maskedmerge[out]`;
    const destination = join(directory, 'output.png');
    await execute(ffmpeg, ['-v', 'error', '-nostdin', '-threads', '2', ...guard, '-i', image, ...guard, '-i', mask,
      '-filter_complex_threads', '1', '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-c:v', 'png', destination],
      { signal: bounded, timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    if ((await stat(destination)).size > 64 * 1024 * 1024) throw Error('Output exceeds processor size limit');
    return { status: 'succeeded', media: [{ data: new Uint8Array(await readFile(destination)), mimeType: 'image/png' }] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
