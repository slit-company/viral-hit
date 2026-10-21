import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const MAX_BYTES = 64 * 1024 * 1024;

async function download(url, destination, signal) {
  const parsed = new URL(url);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local))) throw Error('Use HTTPS media or an explicit loopback test server');
  const response = await fetch(parsed, { signal, redirect: 'error' });
  if (!response.ok || !response.body) throw Error('Source video is unavailable');
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) { await response.body.cancel(); throw Error('Video exceeds 64 MiB'); }
  const file = await open(destination, 'wx', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      bytes += chunk.length;
      if (bytes > MAX_BYTES) throw Error('Video exceeds 64 MiB');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) offset += (await file.write(chunk, offset, chunk.length - offset)).bytesWritten;
    }
  } finally { await file.close(); }
  if (!bytes) throw Error('Source video is empty');
  return { bytes, sha256: hash.digest('hex') };
}

/** Real technical inspection, not an AI/semantic analysis example. No model or daemon is installed. */
export async function createGeneration({ model, input, signal, readMedia }) {
  if (!['technical-video-review', 'vertical-delivery-review'].includes(model.id)) throw Error('Unsupported inspection profile');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  const directory = await mkdtemp(join(tmpdir(), 'viral-hit-inspect-'));
  try {
    const path = join(directory, 'source');
    let source;
    if (readMedia) {
      const media = await readMedia(input.videoUrl);
      bounded.throwIfAborted();
      await writeFile(path, media.bytes, { flag: 'wx', mode: 0o600 });
      source = { bytes: media.sizeBytes, sha256: media.sha256 };
    } else source = await download(input.videoUrl, path, bounded);
    const { stdout } = await execute(process.env.VIRAL_HIT_FFPROBE, [
      '-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', path,
    ], { signal: bounded, timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' });
    const report = JSON.parse(stdout);
    const video = report.streams?.find(stream => stream.codec_type === 'video');
    const audio = report.streams?.filter(stream => stream.codec_type === 'audio') ?? [];
    if (!video || !(video.width > 0) || !(video.height > 0)) throw Error('No readable video stream');
    const duration = Number(report.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw Error('Video duration is unavailable');
    const lines = [
      'Technical inspection — measured file metadata',
      `Source SHA-256: ${source.sha256}`,
      `File: ${source.bytes} bytes; duration: ${duration.toFixed(3)} s`,
      `Video: ${video.width} × ${video.height}; codec: ${video.codec_name}; nominal frame rate: ${video.r_frame_rate}`,
      `Audio: ${audio.length} stream(s)` + (audio.length ? '; ' + audio.map(stream => `${stream.codec_name}, ${stream.sample_rate} Hz, ${stream.channels} channel(s)`).join('; ') : ''),
    ];
    if (model.id === 'vertical-delivery-review') {
      lines.push(Math.abs(video.width / video.height - 9 / 16) < 0.01 ? 'Framing: approximately 9:16.' : 'Framing: differs from 9:16; review the target layout before exporting.');
      lines.push(audio.length ? 'Audio is present; listen to check speech and music balance.' : 'No audio stream; confirm that a silent delivery is intended.');
    }
    lines.push('Limits: no visual, dialogue, timing-quality or platform-policy review. Nominal frame rate does not establish constant cadence. No pixels/audio were assessed for creative quality.');
    lines.push('Requested focus (recorded, not interpreted by this processor): ' + String(input.prompt).slice(0, 12_000));
    const end = Math.round(duration * 1000) / 1000;
    const structuredReport = end >= .01 && end <= 3600 ? {
      schemaVersion: 1, summary: 'Measured file metadata; inspect the source before making creative decisions.',
      observations: [{ id: 'whole-video', start: 0, end,
        description: `${video.width} × ${video.height} ${video.codec_name} video, ${duration.toFixed(3)} seconds, ${audio.length} audio stream(s). No scene or narrative interpretation was performed.` }],
    } : undefined;
    return { status: 'succeeded', text: lines.join('\n'), ...(structuredReport ? { report: structuredReport } : {}) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
