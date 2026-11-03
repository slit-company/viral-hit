import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerManifest } from '../src/profiles.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url))), directory = join(root, 'dist/providers/comfy');
await mkdir(directory, { recursive: true });
await build({ entryPoints: [join(root, 'src/provider.mjs')], outfile: join(directory, 'provider.mjs'), platform: 'node', format: 'esm', bundle: true, target: 'node24' });
// Published prices from Comfy's partner pricing, converted at 211 credits per US dollar (see docs/COSTS.md).
const pricing = JSON.parse(await readFile(join(root, 'src/pricing.json'), 'utf8'));
const base = providerManifest(), unknown = Object.keys(pricing).filter(id => !base.models.some(model => model.id === id));
if (unknown.length) throw Error('pricing.json names unknown models: ' + unknown.join(', '));
const manifest = { ...base, models: base.models.map(model => pricing[model.id] ? { ...model, pricing: pricing[model.id] } : model) }, source = await readFile(join(directory, 'provider.mjs'), 'utf8');
await writeFile(join(directory, 'provider.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(root, 'dist/comfy.runtime.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-runtime-package', id: 'comfy', version: '0.2.0', title: 'Comfy Router models', description: manifest.description, author: 'Viral Hit contributors', license: 'Apache-2.0', scope: 'general', requirements: 'A Comfy API key with Router access and credits. Selected project image/audio references are sent with generation requests. No runtime dependencies or local model downloads.', entries: [{ kind: 'provider', manifest, source }] }, null, 2) + '\n');
console.log('Built Comfy Router provider with ' + manifest.models.length + ' models; no runtime dependencies.');
