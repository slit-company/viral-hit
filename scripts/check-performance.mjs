import { readFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budget = JSON.parse(await readFile(join(root, 'docs/performance-budget.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'apps/studio/package.json'), 'utf8'));
const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies };
const forbidden = budget.separateRuntimePackages.filter(name => dependencies[name]);
if (forbidden.length) throw new Error(`Keep optional engines out of the studio install: ${forbidden.join(', ')}`);
let files = 0, bytes = 0, scriptBytes = 0, scriptGzipBytes = 0;
async function visit(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.isFile()) {
      const content = await readFile(file); files++; bytes += content.length;
      if (/\.[cm]?js$/.test(entry.name)) { scriptBytes += content.length; scriptGzipBytes += gzipSync(content).length; }
    }
  }
}
await visit(join(root, 'apps/studio/.output/public')).catch(error => { throw new Error('Build the studio before measuring its production bundle', { cause: error }); });
const report = { files, bytes, scriptBytes, scriptGzipBytes, limits: budget.client };
console.log(JSON.stringify(report, null, 2));
if (bytes > budget.client.totalBytes || scriptGzipBytes > budget.client.allScriptsGzipBytes) throw new Error('Production bundle exceeded its budget. Investigate the dependency/chunk change before changing the budget.');
