#!/usr/bin/env node
// Bundles each provider into dist/providers/<id>/ with its provider.json, ready for VIRAL_HIT_PROVIDERS_DIR.
import { build } from 'esbuild';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ids = (await readdir(join(root, 'src/providers'), { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
await rm(join(root, 'dist'), { recursive: true, force: true });
const entries = [];
for (const id of ids) {
  const source = join(root, 'src/providers', id, 'provider.mjs'), directory = join(root, 'dist/providers', id);
  const { manifest } = await import(pathToFileURL(source).href);
  if (manifest?.id !== id) throw Error(id + '/provider.mjs must export a manifest with id ' + id);
  await mkdir(directory, { recursive: true });
  await build({ entryPoints: [source], outfile: join(directory, 'provider.mjs'), platform: 'node', format: 'esm', bundle: true, target: 'node24', legalComments: 'none' });
  const json = { schemaVersion: 1, kind: 'viral-hit-provider', id, label: manifest.label, description: manifest.description, scope: 'general', author: 'Viral Hit contributors', license: 'Apache-2.0', referenceDelivery: 'project-media', configurationDelivery: 'request', connectionTest: true, ...(manifest.setupUrl ? { setupUrl: manifest.setupUrl } : {}), ...(manifest.keyFormat ? { keyFormat: manifest.keyFormat } : {}), entry: 'provider.mjs', mediaHosts: [], environment: manifest.environment, models: manifest.models };
  await writeFile(join(directory, 'provider.json'), JSON.stringify(json) + '\n');
  entries.push({ kind: 'provider', manifest: json, source: await readFile(join(directory, 'provider.mjs'), 'utf8') });
  console.log(id.padEnd(11) + manifest.models.length + ' models');
}
await writeFile(join(root, 'dist/model-apis.runtime.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-runtime-package', id: 'model-apis', version: '0.1.0', title: 'Creative model APIs', description: 'OpenAI, Google Gemini, xAI, ElevenLabs, fal, Runway and Higgsfield providers.', author: 'Viral Hit contributors', license: 'Apache-2.0', scope: 'general', requirements: 'An API key for each service you connect. References are sent to a service only when a generation is submitted. No local model download.', entries }) + '\n');
