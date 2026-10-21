import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);

/** Processes one verified file at a time; does not download media or install an engine. */
export async function createGeneration({ input, signal, readMedia }) {
  if (!readMedia) throw Error('This processor requires project-media delivery');
  const sources = [
    ...(input.imageUrls ?? []).map(url => ({ kind: 'image', url })),
    ...(input.videoUrls ?? (input.videoUrl ? [input.videoUrl] : [])).map(url => ({ kind: 'video', url })),
    ...(input.audioUrls ?? []).map(url => ({ kind: 'audio', url })),
  ];
  if (!sources.length || sources.length > 16) throw Error('Supply 1–16 media sources');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  const directory = await mkdtemp(join(tmpdir(), 'viral-hit-batch-inspect-'));
  const lines = ['Media batch review — measured file metadata'];
  try {
    for (const [index, source] of sources.entries()) {
      bounded.throwIfAborted();
      const media = await readMedia(source.url);
      if (media.kind !== source.kind) throw Error('Source type does not match its declared input');
      const path = join(directory, 'source');
      try {
        await writeFile(path, media.bytes, { flag: 'wx', mode: 0o600 });
        const { stdout } = await execute(process.env.VIRAL_HIT_FFPROBE, [
          '-v', 'error', '-protocol_whitelist', 'file,pipe',
          '-format_whitelist', 'mov,matroska,webm,wav,mp3,flac,ogg,aac,image2,png_pipe,jpeg_pipe,webp_pipe',
          '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,sample_rate,channels', '-of', 'json', path,
        ], { signal: bounded, timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' });
        const measured = JSON.parse(stdout);
        const streams = measured.streams ?? [];
        if (!streams.some(stream => stream.codec_type === (source.kind === 'audio' ? 'audio' : 'video'))) throw Error('Source has no readable ' + source.kind + ' stream');
        lines.push(`${index + 1}. ${source.kind}: ${media.filename}`, `Bytes: ${media.sizeBytes}; SHA-256: ${media.sha256}`);
        const duration = Number(measured.format?.duration);
        if (Number.isFinite(duration) && duration > 0) lines.push(`Duration: ${duration.toFixed(3)} s`);
        for (const stream of streams) {
          if (stream.codec_type === 'video') lines.push(`Picture: ${stream.width} × ${stream.height}; codec: ${stream.codec_name}`);
          if (stream.codec_type === 'audio') lines.push(`Audio: ${stream.codec_name}; ${stream.sample_rate} Hz; ${stream.channels} channel(s)`);
        }
      } finally { await rm(path, { force: true }); }
    }
    lines.push('Limits: technical inventory only. No visual, speech, narrative or creative-quality interpretation. Sources are grouped image, video, audio, preserving order within each group.');
    lines.push('Requested focus (recorded, not interpreted): ' + String(input.prompt).slice(0, 12_000));
    return { status: 'succeeded', text: lines.join('\n') };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
