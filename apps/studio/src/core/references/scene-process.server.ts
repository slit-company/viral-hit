import { spawn } from 'node:child_process';

/** Bound diagnostics and wait for process/pipe closure before deleting a scan's source copy. */
export function runSceneProcess(executable: string, args: string[], signal: AbortSignal, timeoutMs: number, maxBytes: number): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    let bytes = 0, failure: Error | undefined, force: ReturnType<typeof setTimeout> | undefined;
    const stop = (message: string) => {
      if (failure) return;
      failure = new Error(message);
      child.kill('SIGTERM');
      force = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    const abort = () => stop('Scene detector was canceled');
    const deadline = setTimeout(() => stop('Scene detector exceeded its execution deadline'), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const collect = (chunk: Buffer, retain: boolean) => {
      bytes += chunk.length;
      if (bytes > maxBytes) stop('Scene detector exceeded its output limit');
      if (!failure && retain) output.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, false));
    child.once('error', () => { failure ??= new Error('Scene detector could not start'); });
    child.once('close', code => {
      clearTimeout(deadline); clearTimeout(force); signal.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error('Scene detector failed; check FFmpeg availability and source format'));
      else resolve(Buffer.concat(output).toString('utf8'));
    });
  });
}
