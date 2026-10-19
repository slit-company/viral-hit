import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument, checkSong, checkTimeline, checkValidation } from './input.mjs';
import { runJson } from './process.mjs';
import { inspectRuntime, childEnvironment } from './runtime.mjs';

export function createAdapter(engine, { parse = input => (engine === 'music' ? checkSong : checkTimeline)(parseDocument(input.document)), prepare, renderTimeoutMs = 40000 } = {}) {
  return {
    recovery: 'replay',
    async submit(input, context) {
      context.signal.throwIfAborted();
      return { id: context.key };
    },
    async poll(id, input, signal, context) {
      const saved = await context.readBinary();
      if (saved) return { state: 'succeeded', output: saved };
      signal.throwIfAborted();
      const runtime = await inspectRuntime(process.env.VIRAL_HIT_LOCAL_MEDIA_DIR, engine);
      let document;
      try { document = parse(input); }
      catch (error) { return { state: 'failed', error: error.message.slice(0, 8000) }; }
      const work = await mkdtemp(join(tmpdir(), 'viral-hit-local-media-'));
      try {
        const env = childEnvironment(work, engine);
        const source = join(work, engine === 'music' ? 'score.song.json' : 'motion.timeline.json');
        const target = join(work, engine === 'music' ? 'output.wav' : 'output.mp4');
        const options = { cwd: work, env, signal };
        let bytes;
        try {
          if (prepare) document = await prepare(document, input, context, work, options);
          await writeFile(source, JSON.stringify(document));
          const validated = await runJson(process.execPath, [runtime.bin, 'validate', source, '--json'], { ...options, timeoutMs: 10000 });
          checkValidation(engine, validated, document);
          const flags = engine === 'music' ? ['--bits', '16'] : ['--jobs', '1', '--profile', 'final', '--no-cache', '--hw-accel', 'disable'];
          await runJson(process.execPath, [runtime.bin, 'render', source, '--out', target, ...flags, '--json'], { ...options, timeoutMs: renderTimeoutMs });
          const info = await stat(target);
          if (!info.isFile() || info.size < 44 || info.size > 64 * 1024 * 1024) throw new Error('Rendered media exceeds the 64 MiB output limit or is empty');
          bytes = await readFile(target);
        } catch (error) {
          signal.throwIfAborted();
          return { state: 'failed', error: error.message.slice(0, 8000) };
        }
        signal.throwIfAborted();
        const output = await context.publishBinary(bytes, { model: runtime.model, providerJobId: id, contentType: engine === 'music' ? 'audio/wav' : 'video/mp4', creditsUsed: '0' });
        return { state: 'succeeded', output };
      } finally { await rm(work, { recursive: true, force: true }); }
    },
    async cancel() { return { state: 'canceled' }; },
  };
}
