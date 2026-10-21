import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export async function hashFile(file, signal, maxBytes) {
  if (!file || !isAbsolute(file)) throw Error('Configure absolute transcription runtime paths');
  const info = await stat(file);
  if (!info.isFile() || info.size <= 0 || info.size > maxBytes) throw Error('Transcription runtime file is missing or exceeds its size limit');
  const hash = createHash('sha256'); let size = 0;
  for await (const chunk of createReadStream(file, { signal, highWaterMark: 1024 * 1024 })) {
    size += chunk.length; if (size > maxBytes) throw Error('Transcription runtime file grew beyond its limit'); hash.update(chunk);
  }
  if (size !== info.size) throw Error('Transcription runtime changed while reading');
  return hash.digest('hex');
}
export async function runtime(signal) {
  const cli = process.env.VIRAL_HIT_WHISPER_CLI, model = process.env.VIRAL_HIT_WHISPER_MODEL;
  const cliSha256 = process.env.VIRAL_HIT_WHISPER_CLI_SHA256, modelSha256 = process.env.VIRAL_HIT_WHISPER_MODEL_SHA256;
  for (const digest of [cliSha256, modelSha256]) if (!/^[a-f0-9]{64}$/.test(digest ?? '')) throw Error('Configure exact Whisper CLI/model SHA-256 values');
  for (const file of [process.env.VIRAL_HIT_FFMPEG, process.env.VIRAL_HIT_FFPROBE]) if (!file || !isAbsolute(file)) throw Error('Configure absolute FFmpeg and FFprobe executables');
  if (await hashFile(cli, signal, 256 * 1024 * 1024) !== cliSha256 || await hashFile(model, signal, 2 * 1024 ** 3) !== modelSha256) throw Error('Whisper CLI or model bytes changed; restore the pinned runtime');
  return { cli, model, cliSha256, modelSha256 };
}
