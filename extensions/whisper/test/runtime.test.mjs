import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtime } from '../src/runtime.mjs';
test('changed model bytes fail even at the same path; missing hashes and relative executable paths fail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vh-whisper-runtime-'));
  const names = ['VIRAL_HIT_WHISPER_CLI','VIRAL_HIT_WHISPER_CLI_SHA256','VIRAL_HIT_WHISPER_MODEL','VIRAL_HIT_WHISPER_MODEL_SHA256','VIRAL_HIT_FFMPEG','VIRAL_HIT_FFPROBE'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const type of ['CLI', 'MODEL']) {
      const file = join(directory, type); await writeFile(file, type);
      process.env['VIRAL_HIT_WHISPER_' + type] = file;
      process.env['VIRAL_HIT_WHISPER_' + type + '_SHA256'] = createHash('sha256').update(type).digest('hex');
    }
    process.env.VIRAL_HIT_FFMPEG = '/operator/ffmpeg'; process.env.VIRAL_HIT_FFPROBE = '/operator/ffprobe';
    const signal = AbortSignal.timeout(10000); assert.equal((await runtime(signal)).model, join(directory, 'MODEL'));
    process.env.VIRAL_HIT_FFMPEG = 'ffmpeg'; await assert.rejects(runtime(signal), /absolute FFmpeg/);
    process.env.VIRAL_HIT_FFMPEG = '/operator/ffmpeg';
    process.env.VIRAL_HIT_WHISPER_CLI = 'whisper-cli'; await assert.rejects(runtime(signal), /absolute transcription/);
    process.env.VIRAL_HIT_WHISPER_CLI = join(directory, 'CLI');
    await writeFile(join(directory, 'MODEL'), 'CHANGED'); await assert.rejects(runtime(signal), /bytes changed/);
    delete process.env.VIRAL_HIT_WHISPER_MODEL_SHA256; await assert.rejects(runtime(signal), /SHA-256/);
  } finally {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    await rm(directory, { recursive: true, force: true });
  }
});
