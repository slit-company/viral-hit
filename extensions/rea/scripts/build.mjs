import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { descriptor } from '../src/descriptor.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url))), dist = join(root, 'dist');
await mkdir(join(dist, 'adapters'), { recursive: true });
const entry = 'rea.mjs';
await build({ entryPoints: [join(root, 'src/adapter.mjs')], outfile: join(dist, 'adapters', entry), bundle: true, platform: 'node', format: 'esm', target: 'node24' });
const source = await readFile(join(dist, 'adapters', entry), 'utf8');
const manifest = descriptor(entry, createHash('sha256').update(source).digest('hex'));
const metadata = { id: 'app-inspection', version: '1.0.0', title: 'App and website inspection', description: 'Inspect configured JavaScript apps and browser targets with REA, retain evidence and prepare a reconstruction plan.', author: 'Viral Hit contributors', license: 'Apache-2.0', scope: 'general' };
await writeFile(join(dist, 'adapters/rea.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(dist, 'rea.runtime.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-runtime-package', ...metadata,
  requirements: 'Operator-installed rea-agents 6.8.0 with a supported Node runtime, a pinned CLI entry, registered targets and a private evidence directory. Nothing is installed automatically.',
  entries: [{ kind: 'adapter', manifest, source }] }, null, 2) + '\n');
const recipes = ['website', 'javascript'].map(kind => ({ schemaVersion: 1, id: 'rea-' + kind, version: '1.0.0', title: kind === 'website' ? 'Inspect a website' : 'Inspect a JavaScript or Electron app',
  description: 'Read one registered target with REA. Review observed structure, static candidates and coverage limits before planning a reconstruction. No target code or discovered API is invoked.',
  author: metadata.author, license: metadata.license, category: 'research',
  parameters: [{ id: 'target', label: 'Configured target ID', type: 'string', minLength: 1, maxLength: 128 },
    { id: 'question', label: 'Feature to investigate', type: 'string', default: 'How is this feature structured, and what evidence would verify its behavior?', multiline: true, minLength: 1, maxLength: 2000 }],
  nodes: [{ id: 'inspect', operation: manifest.operation, version: manifest.version, cache: false, input: { kind, targetId: '', question: '' },
    parameters: [{ parameter: 'target', target: '/targetId' }, { parameter: 'question', target: '/question' }] }],
}));
await writeFile(join(dist, 'rea.pack.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-pack', ...metadata, id: 'rea', useCases: ['research', 'app-analysis', 'reconstruction'], recipes }, null, 2) + '\n');
const instructions = await readFile(join(root, 'skill/SKILL.md'), 'utf8');
const skillManifest = JSON.parse(await readFile(join(root, 'skill/skill.json'), 'utf8'));
await writeFile(join(dist, 'rea.skill.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-skill', manifest: skillManifest, instructions }, null, 2) + '\n');
console.log('Built an optional REA runtime, two recipes and a companion skill. No REA or native engine installed.');
