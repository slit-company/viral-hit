import { spawn } from 'node:child_process';

function failureMessage(code, stdout, stderr) {
  try {
    const result = JSON.parse(stdout);
    if (result?.ok === false && typeof result.error?.message === 'string') {
      const issues = Array.isArray(result.error.details?.issues) ? result.error.details.issues.slice(0, 3)
        .filter(issue => typeof issue?.message === 'string')
        .map(issue => `${typeof issue.path === 'string' ? issue.path + ': ' : ''}${issue.message}`).join('; ') : '';
      return `Local tool rejected the document: ${result.error.message}${issues ? '. ' + issues : ''}`.slice(0, 4000);
    }
  } catch { /* Non-JSON tools still report a bounded diagnostic. */ }
  return `Local tool exited ${code}: ${(stderr || stdout).slice(-8192)}`;
}

// A separate POSIX process group lets cancellation stop Bun/FFmpeg descendants too.
export function runProcess(command, args, { cwd, env, signal, timeoutMs = 120000, maxBytes = 1024 * 1024 }) {
  signal?.throwIfAborted();
  if (process.platform === 'win32') throw new Error('Local media adapters currently require macOS or Linux process groups');
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let failure, stdout = '', stderr = '', size = 0, stopped = false;
    const stop = error => {
      failure ??= error;
      if (stopped) return;
      stopped = true;
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch (cause) { if (cause.code !== 'ESRCH') failure = new Error(`${failure.message}; process group stop failed: ${cause.code}`, { cause }); }
      }
    };
    const abort = () => stop(signal.reason ?? new Error('Local render canceled'));
    const timer = setTimeout(() => stop(new Error(`Local render exceeded ${timeoutMs} ms`)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) stop(new Error('Local tool output exceeded its byte limit'));
      else stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.on('error', error => { failure ??= error; });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      // Also reap descendants that outlived a successful launcher.
      if (child.pid && !stopped) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') failure ??= error; }
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(failureMessage(code, stdout, stderr)));
      else resolve(stdout);
    });
  });
}

export async function runJson(command, args, options) {
  const text = await runProcess(command, args, options);
  let response;
  try { response = JSON.parse(text); } catch { throw new Error('Local tool returned invalid JSON'); }
  if (!response || response.ok !== true) throw new Error('Local tool did not confirm success');
  return response;
}
