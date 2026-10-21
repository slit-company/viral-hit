import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtime } from './runtime.mjs';
import { run } from './process.mjs';
import { normalizeTranscript } from './transcript.mjs';

export function checkInput(input) {
  const { videoAssetId, audioAssetId, start, duration, language, maxChars, threads } = input;
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
  if (!(validId(videoAssetId) && audioAssetId === null || validId(audioAssetId) && videoAssetId === null)
    || !Number.isFinite(start) || start < 0 || start > 3600 || !Number.isFinite(duration) || duration < 1 || duration > 120
    || !/^(auto|[a-z]{2,3})$/.test(language) || !Number.isInteger(maxChars) || maxChars < 16 || maxChars > 160
    || !Number.isInteger(threads) || threads < 1 || threads > 4) throw Error('Invalid local transcription inputs');
  return videoAssetId === null ? 'audio' : 'video';
}
const requestId = (input, runtime) => createHash('sha256').update(JSON.stringify([input, runtime.cliSha256, runtime.modelSha256])).digest('hex');
async function probe(file, options) {
  const raw = JSON.parse(await run(process.env.VIRAL_HIT_FFPROBE, ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,mp3,wav,ogg', '-show_streams', '-show_format', '-of', 'json', file], options));
  const seconds = Number(raw.format?.duration);
  if (!Array.isArray(raw.streams) || !raw.streams.some(stream => stream.codec_type === 'audio') || !Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw Error('Choose media with an audio stream and duration of at most one hour');
  return seconds;
}
export default {
  recovery: 'replay',
  async submit(input, context) {
    checkInput(input); const tools = await runtime(context.signal);
    return { id: requestId(input, tools) };
  },
  async poll(id, input, signal, context) {
    const kind = checkInput(input), tools = await runtime(signal);
    if (id !== requestId(input, tools)) throw Error('Transcription receipt does not match its request');
    const source = await context.readAsset(kind);
    if (source.kind !== kind || source.assetId !== input[kind + 'AssetId'] || source.sizeBytes > 64 * 1024 * 1024) throw Error('Transcription source identity mismatch');
    const work = await mkdtemp(join(tmpdir(), 'vh-whisper-'));
    try {
      const options = { signal, cwd: work, threads: input.threads }, original = join(work, 'source.bin'), wav = join(work, 'speech.wav'), target = join(work, 'transcript');
      await writeFile(original, source.bytes, { flag: 'wx', mode: 0o600 });
      const sourceDuration = await probe(original, options);
      const duration = Math.min(input.duration, Math.floor((sourceDuration - input.start) * 1000) / 1000);
      if (duration < .01) throw Error('Selected transcription start is outside the source');
      await run(process.env.VIRAL_HIT_FFMPEG, ['-nostdin', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,mp3,wav,ogg', '-i', original, '-ss', String(input.start), '-t', String(duration), '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], options);
      if ((await stat(wav)).size > 4 * 1024 * 1024) throw Error('Decoded speech exceeds 4 MiB');
      const decodedDuration = Math.min(duration, await probe(wav, options));
      const version = (await run(tools.cli, ['--version'], { ...options, timeoutMs: 5000, maxBytes: 65536 })).trim();
      if (!/^whisper\.cpp version: [\w.+-]{1,40}$/.test(version)) throw Error('Unsupported Whisper CLI version output');
      await run(tools.cli, ['-m', tools.model, '-f', wav, '-l', input.language, '-t', String(input.threads), '-p', '1', '-ng', '-ml', String(input.maxChars), '-sow', '-oj', '-of', target, '-np', '-sns'], { ...options, timeoutMs: 180000 });
      const outputPath = target + '.json';
      if ((await stat(outputPath)).size > 512 * 1024) throw Error('Whisper transcript exceeds 512 KiB');
      const raw = JSON.parse(await readFile(outputPath, 'utf8'));
      await runtime(signal); // Do not accept output after mutable external CLI/model files change.
      const output = normalizeTranscript(raw, { source, start: input.start, duration: decodedDuration,
        engine: { id: 'whisper.cpp', version, model: String(raw.model?.type ?? 'unknown').slice(0, 100), cliSha256: tools.cliSha256, modelSha256: tools.modelSha256 } });
      return { state: 'succeeded', output };
    } finally { await rm(work, { recursive: true, force: true }); }
  },
  async cancel() { return { state: 'canceled' }; },
};
