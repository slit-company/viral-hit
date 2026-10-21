import { open } from 'node:fs/promises';
import { assetGenerationRequest } from '../src/core/generation-providers/asset-generation';
import { requestAssetGeneration } from '../src/core/generation-providers/asset-generation.server';
import { listGenerationModelDescriptors } from '../src/core/generation-providers/model-catalog';
import { installGenerationProviders } from '../src/core/generation-providers/installed/install.server';

const [action, file] = process.argv.slice(2);
try {
  installGenerationProviders();
  if (action === 'models') console.log(JSON.stringify(listGenerationModelDescriptors(), null, 2));
  else if (action === 'request' && file) {
    const handle = await open(file, 'r');
    let text: string;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 256_000) throw Error('Choose a request JSON file up to 256 KB');
      const bytes = Buffer.alloc(256_001), result = await handle.read(bytes, 0, bytes.length, 0);
      if (result.bytesRead > 256_000) throw Error('Request exceeds 256 KB');
      text = bytes.subarray(0, result.bytesRead).toString('utf8');
    } finally { await handle.close(); }
    console.log(JSON.stringify(await requestAssetGeneration(assetGenerationRequest.parse(JSON.parse(text)), 'cli'), null, 2));
  } else throw Error('Usage: generation models | request <request.json>');
} catch (error) { console.error(error instanceof Error ? error.message : 'Generation request failed'); process.exitCode = 1; }
