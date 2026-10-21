import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { providerManifestSchema } from '../src/core/generation-providers/installed/manifest';
import { installGenerationProviders, readProviderFolder } from '../src/core/generation-providers/installed/install.server';

// Usage: pnpm provider list | check <provider-folder> | schema <out.json>
// list shows what VIRAL_HIT_PROVIDERS_DIR installs; check validates one folder and loads its module without generating.
const [command, target] = process.argv.slice(2);
const nativeImport = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, unknown>>;
try {
  if (command === 'list') {
    const { providers, problems } = installGenerationProviders();
    for (const provider of providers) console.log([provider.id, provider.scope, provider.models.map(model => model.id + ' (' + model.kind + ')').join(', ')].join('\t'));
    for (const problem of problems) console.log(['problem', problem.location, problem.message].join('\t'));
    if (!process.env.VIRAL_HIT_PROVIDERS_DIR) console.log('Set VIRAL_HIT_PROVIDERS_DIR to install providers.');
  } else if (command === 'check' && target) {
    const { manifest, source } = readProviderFolder(resolve(target));
    const module = await nativeImport('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    if (typeof module.createGeneration !== 'function') throw new Error('The provider module must export createGeneration');
    const { id, label, scope, author, license, mediaHosts } = manifest;
    console.log(JSON.stringify({ id, label, scope, author: author ?? null, license: license ?? null, mediaHosts, checkStatus: typeof module.checkStatus === 'function', models: manifest.models.map(model => ({ id: model.id, kind: model.kind })) }, null, 2));
  } else if (command === 'schema' && target) {
    // Describes what authors write, so defaulted fields stay optional.
    await writeFile(resolve(target), JSON.stringify(z.toJSONSchema(providerManifestSchema, { io: 'input' }), null, 2) + '\n', { flag: 'wx' });
  } else {
    throw new Error('Usage: provider list | check <provider-folder> | schema <out.json>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Provider command failed');
  process.exitCode = 1;
}
