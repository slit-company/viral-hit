import { spawn } from 'node:child_process';

/** Wait for engine exit before removing its work directory; never buffer provider diagnostics. */
export function runYouTubeEngine(executable: string, engine: string, videoId: string, directory: string, height: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'SystemRoot', 'DOTNET_ROOT', 'VIRAL_HIT_FFMPEG']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const child = spawn(executable, [engine, videoId, directory, String(height)], { stdio: 'ignore', env });
    let stopping = false, force: ReturnType<typeof setTimeout> | undefined;
    const fail = () => new Error('YouTube engine failed or was canceled; no reference was accepted');
    const stop = () => {
      if (stopping) return;
      stopping = true;
      child.kill('SIGTERM');
      force = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    const deadline = setTimeout(stop, 190000);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const clean = () => { clearTimeout(deadline); clearTimeout(force); signal.removeEventListener('abort', stop); };
    child.once('error', () => { clean(); reject(fail()); });
    child.once('close', code => { clean(); if (code === 0 && !stopping) resolve(); else reject(fail()); });
  });
}
