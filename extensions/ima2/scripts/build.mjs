import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PROVIDERS } from '../src/adapter.mjs';

const root = new URL('../', import.meta.url);
const directory = new URL('dist/adapters/', root);
await mkdir(directory, { recursive: true });
const source = await readFile(new URL('src/adapter.mjs', root));
for (const reference of [false, true]) {
  const name = reference ? 'ima2-reference' : 'ima2-image';
  const entry = `${name}.mjs`;
  const properties = {
    provider: { type: 'string', enum: PROVIDERS },
    model: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,139}$' },
    prompt: { type: 'string', minLength: 1, maxLength: 16000, pattern: '\\S' },
    quality: { type: 'string', enum: ['low', 'medium', 'high'] },
    size: { type: 'string', enum: ['1024x1024', '1536x1024', '1024x1536'] },
    ...(reference ? { source: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' } } : {}),
  };
  const descriptor = {
    schemaVersion: 1, operation: `ext.${name}`, version: '1',
    label: reference ? 'ima2 reference image' : 'ima2 image',
    author: 'Viral Hit contributors', license: 'Apache-2.0', entry,
    sha256: createHash('sha256').update(source).digest('hex'), recovery: 'reconcile', generation: true,
    configuration: [{ name: 'VIRAL_HIT_IMA2_URL', required: true }, { name: 'VIRAL_HIT_IMA2_TOKEN', required: false }],
    ...(reference ? { assetInputs: [{ id: 'source', pointer: '/source', kind: 'image', maxBytes: 32 * 1024 * 1024 }] } : {}),
    inputSchema: { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) },
  };
  await writeFile(new URL(entry, directory), source);
  await writeFile(new URL(`${name}.json`, directory), JSON.stringify(descriptor, null, 2) + '\n');
}
console.log(`Built two dependency-free ima2 adapters at ${fileURLToPath(directory)}`);
