import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/process.mjs';

test('local process output and deadline are bounded', async () => {
  const options = { signal: AbortSignal.timeout(10000), cwd: tmpdir(), timeoutMs: 5000 };
  assert.equal(await run(process.execPath, ['-e', 'process.stdout.write("ok")'], options), 'ok');
  await assert.rejects(run(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], { ...options, maxBytes: 64 }), /output limit/);
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { ...options, timeoutMs: 100 }), /deadline/);
  await assert.rejects(run('/nonexistent-whisper-cli', [], options), /could not start/);
});
test('cancellation does not settle before a delayed child confirms shutdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vh-whisper-process-')), started = join(directory, 'started'), stopped = join(directory, 'stopped');
  try {
    const code = `const fs=require('node:fs');process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(stopped)},'yes');process.exit(0)},150));fs.writeFileSync(${JSON.stringify(started)},'yes');setInterval(()=>{},1000);`;
    const controller = new AbortController(), pending = run(process.execPath, ['-e', code], { signal: controller.signal, cwd: directory });
    const rejection = assert.rejects(pending, /canceled/);
    for (let i = 0; i < 100; i++) { if (await stat(started).catch(() => null)) break; await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.equal(await readFile(started, 'utf8'), 'yes'); controller.abort(); await rejection;
    assert.equal(await readFile(stopped, 'utf8'), 'yes');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
