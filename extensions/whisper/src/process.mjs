import { spawn } from 'node:child_process';

export function run(executable, args, { signal, cwd, timeoutMs = 20000, maxBytes = 1048576, threads = 2 }) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: {
      PATH: '/usr/bin:/bin', HOME: cwd, TMPDIR: cwd, LANG: 'en_US.UTF-8',
      OMP_NUM_THREADS: String(threads), OPENBLAS_NUM_THREADS: String(threads), VECLIB_MAXIMUM_THREADS: String(threads),
    } });
    const output = []; let size = 0, failure, force;
    const stop = message => {
      if (failure) return;
      failure = Error(message); child.kill('SIGTERM');
      force = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    const abort = () => stop('Transcription canceled');
    const deadline = setTimeout(() => stop('Transcription tool exceeded its deadline'), timeoutMs);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const collect = (chunk, keep) => { size += chunk.length; if (size > maxBytes) stop('Transcription tool exceeded its output limit'); if (keep && !failure) output.push(chunk); };
    child.stdout.on('data', chunk => collect(chunk, true)); child.stderr.on('data', chunk => collect(chunk, false));
    child.once('error', () => { failure ??= Error('Transcription tool could not start'); });
    child.once('close', code => {
      clearTimeout(deadline); clearTimeout(force); signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(Error('Transcription tool failed; verify the configured runtime and input media'));
      else resolve(Buffer.concat(output).toString('utf8'));
    });
  });
}
