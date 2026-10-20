import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportProjectBundle } from '../src/core/projects/bundles/export.server';
import { inspectProjectBundle, acceptProjectBundle } from '../src/core/projects/bundles/import.server';
import { bundlePath } from '../src/core/projects/bundles/storage.server';
import { copyVerified } from '../src/core/projects/bundles/tar.server';

const [operation, subject, argument] = process.argv.slice(2);
try {
  const signal = AbortSignal.timeout(10 * 60_000);
  if (operation === 'export' && subject && argument) {
    const result = await exportProjectBundle(subject, signal);
    const destination = resolve(argument), file = await open(destination, 'wx', 0o600);
    try { await copyVerified(bundlePath(result.id, 'project.tar'), file, { size: result.sizeBytes, sha256: result.sha256, signal }); await file.sync(); }
    finally { await file.close(); }
    console.log(JSON.stringify({ ...result, file: destination }));
  } else if (operation === 'inspect' && subject) {
    console.log(JSON.stringify(await inspectProjectBundle(createReadStream(resolve(subject), { signal }), signal)));
  } else if (operation === 'accept' && subject && argument) {
    console.log(JSON.stringify(await acceptProjectBundle(subject, argument, signal)));
  } else throw Error('Usage: pnpm project:file export PROJECT_ID OUTPUT.viralhit.tar | inspect FILE | accept REVIEW_ID SHA256');
} catch (error) { console.error(error instanceof Error ? error.message : 'Project file operation failed'); process.exitCode = 1; }
