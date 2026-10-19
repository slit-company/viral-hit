import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEDIA_SLOTS } from '../src/media-input.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const lock = hash(await readFile(join(root, 'package-lock.json')));
const directory = join(root, 'dist/adapters');
await mkdir(directory, { recursive: true });
for (const source of ['music', 'video', 'compose']) {
  const engine = source === 'music' ? 'music' : 'video';
  const name = source === 'compose' ? 'vid2-compose' : engine === 'music' ? 'music2-render' : 'vid2-render';
  const entry = `${name}.mjs`;
  await build({ entryPoints: [join(root, `src/${source}.mjs`)], outfile: join(directory, entry), bundle: true, platform: 'node', format: 'esm', target: 'node24', define: { LOCAL_MEDIA_LOCK_SHA256: JSON.stringify(lock) } });
  const descriptor = {
    schemaVersion: 1, operation: `ext.${name}`, version: '1',
    label: source === 'compose' ? 'Project media composition' : engine === 'music' ? 'Local music score' : 'Local motion timeline',
    author: 'Viral Hit contributors', license: 'Apache-2.0', entry,
    sha256: hash(await readFile(join(directory, entry))), recovery: 'replay', generation: false,
    configuration: [
      { name: 'VIRAL_HIT_LOCAL_MEDIA_DIR', required: true },
      ...(engine === 'video' ? ['VIRAL_HIT_FFMPEG', 'VIRAL_HIT_FFPROBE'].map(name => ({ name, required: true })) : []),
    ],
    inputSchema: { type: 'object', additionalProperties: false, properties: { document: { type: 'string', minLength: 2, maxLength: 16000 } }, required: ['document'] },
  };
  if (source === 'compose') {
    descriptor.execution = { timeoutMs: 180000, abortOnCancel: true };
    descriptor.assetInputs = MEDIA_SLOTS.map(slot => ({ ...slot, pointer: `/assets/${slot.id}`, optional: true }));
    descriptor.inputSchema.properties = { timeline: { type: 'object' }, assets: {
      type: 'object', additionalProperties: false, required: MEDIA_SLOTS.map(slot => slot.id),
      properties: Object.fromEntries(MEDIA_SLOTS.map(slot => [slot.id, { type: ['string', 'null'], pattern: '^[a-zA-Z0-9_-]{1,128}$' }])),
    } };
    descriptor.inputSchema.required = ['timeline', 'assets'];
  }
  await writeFile(join(directory, `${name}.json`), JSON.stringify(descriptor, null, 2) + '\n');
}
console.log('Built three optional adapters. Studio dependencies unchanged.');
