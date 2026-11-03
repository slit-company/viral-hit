import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerManifest } from '../src/profiles.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url))), directory = join(root, 'dist/providers/sume');
await mkdir(directory, { recursive: true });
await build({ entryPoints: [join(root, 'src/provider.mjs')], outfile: join(directory, 'provider.mjs'), platform: 'node', format: 'esm', bundle: true, target: 'node24' });
// Prices Sume lists for each model (scripts/sync-prices.mjs); see docs/COSTS.md.
const pricing = JSON.parse(await readFile(join(root, 'src/pricing.json'), 'utf8').catch(() => '{}'));
const base = providerManifest(), unknown = Object.keys(pricing).filter(id => !base.models.some(model => model.id === id));
if (unknown.length) throw Error('pricing.json names unknown models: ' + unknown.join(', '));
const manifest = { ...base, models: base.models.map(model => pricing[model.id] ? { ...model, pricing: pricing[model.id] } : model) }, source = await readFile(join(directory, 'provider.mjs'), 'utf8');
await writeFile(join(directory, 'provider.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(root, 'dist/sume.runtime.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-runtime-package', id: 'sume', version: '0.1.0', title: 'Sume creative APIs', description: 'Connect image, video, Remix, lip sync, captions, voice, music and editing APIs to project assets and the editor.', author: 'Viral Hit contributors', license: 'Apache-2.0', scope: 'general', requirements: 'A Sume API key and paid account balance for generation. Imports local references to Sume when a generation is submitted. No local model download.', entries: [{ kind: 'provider', manifest, source }] }, null, 2) + '\n');
console.log('Built Sume provider with ' + manifest.models.length + ' model/operation profiles; no runtime dependencies.');
