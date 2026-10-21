import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { creativePackManifestSchema, creativePackRequest } from '../src/core/creative-packs/contract';
import { changeCreativePacks } from '../src/core/creative-packs/service.server';
try {
  const [action, path, destination] = process.argv.slice(2);
  if (action === 'schema' && path) { await writeFile(path, JSON.stringify(z.toJSONSchema(creativePackManifestSchema, { io: 'input' }), null, 2) + '\n', { flag: 'wx' }); }
  else {
    let raw: unknown;
    if (action === 'list') raw = { action };
    else if (action === 'fetch' && path && destination) raw = { action, url: path, path: destination };
    else if (action === 'inspect' && path) raw = { action, path };
    else if (action === 'change') {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of process.stdin) { const buffer = Buffer.from(chunk); bytes += buffer.length; if (bytes > 32_000) throw new Error('Request exceeds 32 KB'); chunks.push(buffer); }
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } else throw new Error('Usage: creative-pack list | fetch https://host/file.tar /absolute/new-file.tar | inspect /absolute/file.tar | change < request.json | schema /new/schema.json');
    const result = await changeCreativePacks(creativePackRequest.parse(raw));
    console.log(JSON.stringify(result, null, 2));
    if ('complete' in result && !result.complete) process.exitCode = 1;
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'Creative pack operation failed'); process.exitCode = 1; }
