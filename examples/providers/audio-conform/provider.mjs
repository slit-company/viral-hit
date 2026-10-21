import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);

/** Optional local processor. Authored controls, not prompt interpretation or model inference. */
export async function createGeneration({ input, signal, readMedia }) {
  if (!readMedia || input.audioUrls?.length !== 1 || (input.videoUrls?.length ?? 0) > 1 || input.imageUrls?.length) throw Error('Choose one local audio source and optionally one reference video');
  const { gain = 1, start = 0, seconds = 1 } = input.options ?? {};
  if (![gain, start, seconds].every(Number.isFinite) || gain < 0 || gain > 2 || start < 0 || start > 600 || seconds < .1 || seconds > 30) throw Error('Invalid audio controls');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const directory = await mkdtemp(join(tmpdir(), 'viral-hit-audio-conform-'));
  const ffmpeg = process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ffprobe = process.env.VIRAL_HIT_FFPROBE || 'ffprobe';
  const formats = 'wav,mp3,aac,mov,matroska,webm,ogg,flac';
  async function inspect(path) {
    const { stdout } = await execute(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', formats, '-show_format', '-show_streams', '-of', 'json', path], { signal: bounded, timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' });
    return JSON.parse(stdout);
  }
  try {
    const sourcePath = join(directory, 'source');
    await writeFile(sourcePath, (await readMedia(input.audioUrls[0])).bytes);
    const source = await inspect(sourcePath), sourceDuration = Number(source.format?.duration);
    if (!source.streams?.some(stream => stream.codec_type === 'audio') || !Number.isFinite(sourceDuration) || start >= sourceDuration) throw Error('Source needs a readable audio stream and a start before its end');
    let duration = seconds;
    if (input.videoUrls?.length) {
      const path = join(directory, 'reference');
      await writeFile(path, (await readMedia(input.videoUrls[0])).bytes);
      const video = await inspect(path);
      duration = Number(video.format?.duration);
      if (!video.streams?.some(stream => stream.codec_type === 'video') || !Number.isFinite(duration) || duration < .1 || duration > 30) throw Error('Reference video must have a measured duration between 0.1 and 30 seconds');
      await rm(path);
    }
    const destination = join(directory, 'output.wav');
    await execute(ffmpeg, ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file', '-format_whitelist', formats, '-ss', String(start), '-i', sourcePath, '-map', '0:a:0', '-vn', '-t', String(duration), '-af', `volume=${gain},apad`, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-f', 'wav', destination], { signal: bounded, timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    return { status: 'succeeded', media: [{ data: new Uint8Array(await readFile(destination)), mimeType: 'audio/wav' }] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
