import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runYouTubeEngine } from './youtube-engine.server';

test('engine failures redact diagnostics and cancellation waits for process shutdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vh-engine-test-'));
  try {
    const failed = join(directory, 'failed.mjs');
    await writeFile(failed, "console.error('secret_signed_url'); process.exit(1)");
    await assert.rejects(runYouTubeEngine(process.execPath, failed, 'test', directory, 720, AbortSignal.timeout(1000)), error => {
      assert.ok(error instanceof Error); assert.ok(!error.message.includes('secret_signed_url')); return true;
    });
    await assert.rejects(runYouTubeEngine(join(directory, 'missing'), failed, 'test', directory, 720, AbortSignal.timeout(1000)), /engine failed/);
    const slow = join(directory, 'slow.mjs'), ready = join(directory, 'ready'), stopped = join(directory, 'stopped');
    await writeFile(slow, `import {writeFileSync} from 'node:fs';\nprocess.on('SIGTERM',()=>setTimeout(()=>{writeFileSync(${JSON.stringify(stopped)},'done');process.exit(0)},75));\nwriteFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`);
    const controller = new AbortController();
    const execution = runYouTubeEngine(process.execPath, slow, 'test', directory, 720, controller.signal);
    const rejected = assert.rejects(execution, /engine failed/);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await readFile(ready).catch(() => null)) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(await readFile(ready, 'utf8'), 'ready');
    controller.abort(); await rejected;
    assert.equal(await readFile(stopped, 'utf8'), 'done');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
