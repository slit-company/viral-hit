import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runProcess, runJson } from '../src/process.mjs';
const options = { env: { PATH: '/usr/bin:/bin' }, timeoutMs: 3000 };
test('bounds output and rejects malformed/negative acknowledgements and nonzero exits', async () => {
  assert.deepEqual(await runJson(process.execPath, ['-e', 'console.log(JSON.stringify({ok:true,data:{value:7}}))'], options), { ok: true, data: { value: 7 } });
  await assert.rejects(runJson(process.execPath, ['-e', 'console.log("not json")'], options), /invalid JSON/);
  await assert.rejects(runJson(process.execPath, ['-e', 'console.log("{}")'], options), /confirm success/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(7)'], options), /exited 7/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'console.log(JSON.stringify({ok:false,error:{message:"Invalid voice",details:{issues:[{path:"tracks[0]",message:"Unknown instrument"}]}}}));process.exit(2)'], options), /Invalid voice. tracks\[0\]: Unknown instrument/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], { ...options, maxBytes: 100 }), /byte limit/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},100)'], { ...options, timeoutMs: 100 }), /exceeded/);
});
test('abort kills a launcher and its inherited-pipe descendant', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vh-process-test-')), file = join(directory, 'child.pid');
  const controller = new AbortController();
  const program = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:'inherit'});require('node:fs').writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},100);`;
  const result = runProcess(process.execPath, ['-e', program, file], { ...options, signal: controller.signal });
  const failure = assert.rejects(result, /test cancellation/);
  try {
    let pid;
    for (let i = 0; i < 100; i++) {
      try { pid = Number(await readFile(file, 'utf8')); break; } catch { await delay(10); }
    }
    assert.ok(pid, 'descendant must start before cancellation');
    controller.abort(new Error('test cancellation')); await failure;
    let alive = true;
    for (let i = 0; i < 100; i++) {
      try { process.kill(pid, 0); await delay(10); } catch (error) { assert.equal(error.code, 'ESRCH'); alive = false; break; }
    }
    assert.equal(alive, false, 'descendant is no longer running');
  } finally { controller.abort(new Error('test cancellation')); await rm(directory, { recursive: true, force: true }); }
});
