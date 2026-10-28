import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

/** Bound the analysis process tree, including REA's source-analysis children. */
export function run(node, cli, args, { cwd, signal, timeoutMs = 90000, maxBytes = 8 * 1024 * 1024 }) {
  signal.throwIfAborted();
  if (process.platform === 'win32') throw Error('This bridge currently supports macOS and Linux process groups');
  return new Promise((resolve, reject) => {
    const child = spawn(node, ['--max-old-space-size=512', cli, ...args, '--format', 'json'], {
      cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: dirname(node) + ':/usr/bin:/bin', HOME: cwd, TMPDIR: cwd, LANG: 'en_US.UTF-8', NO_COLOR: '1' },
    });
    let bytes = 0, failure, force; const output = [];
    const kill = signal => { if (child.pid) { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') child.kill(signal); } } };
    const stop = message => { if (failure) return; failure = Error(message); kill('SIGTERM'); force = setTimeout(() => kill('SIGKILL'), 1500); };
    const abort = () => stop('REA analysis canceled');
    const timer = setTimeout(() => stop('REA analysis exceeded its time limit'), timeoutMs);
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const collect = (chunk, keep) => { bytes += chunk.length; if (bytes > maxBytes) stop('REA analysis exceeded its output limit'); if (keep && !failure) output.push(chunk); };
    child.stdout.on('data', chunk => collect(chunk, true)); child.stderr.on('data', chunk => collect(chunk, false));
    child.once('error', () => { failure ??= Error('REA process could not start'); });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(force); signal.removeEventListener('abort', abort);
      // A child must not outlive an aborted CLI after its stdio closes early.
      if (failure) kill('SIGKILL');
      if (failure) reject(failure);
      else if (code !== 0) reject(Error('REA rejected the analysis; check target availability and runtime configuration'));
      else { try { resolve(JSON.parse(Buffer.concat(output).toString('utf8'))); } catch { reject(Error('REA returned invalid JSON')); } }
    });
  });
}
