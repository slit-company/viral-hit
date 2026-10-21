import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { communityCatalogSchema } from '../src/core/community/contract';
import {
  changeCommunity,
  inspectCatalog,
} from '../src/core/community/service.server';
import { downloadedFileDigest } from '../src/lib/download-integrity.server';
const [action, target, extra] = process.argv.slice(2);
try {
  let result: unknown;
  if (action === 'list') result = await changeCommunity({ action });
  else if (action === 'fetch' && target)
    result = await changeCommunity({ action, url: target });
  else if (action === 'inspect' && target)
    result = inspectCatalog(
      JSON.parse(await readFile(resolve(target), 'utf8')),
    );
  else if (action === 'hash' && target)
    result = { sha256: await downloadedFileDigest(resolve(target)) };
  else if (action === 'change' && target)
    result = await changeCommunity(
      JSON.parse(await readFile(resolve(target), 'utf8')),
    );
  else if (action === 'export' && target && extra) {
    const result = await changeCommunity({ action: 'get', id: target });
    if (!('catalog' in result)) throw new Error('Catalog not found');
    await writeFile(
      resolve(extra),
      JSON.stringify(result.catalog, null, 2) + '\n',
      { flag: 'wx' },
    );
  } else if (action === 'schema' && target)
    await writeFile(
      resolve(target),
      JSON.stringify(
        z.toJSONSchema(communityCatalogSchema, { io: 'input' }),
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
  else
    throw new Error(
      'Usage: community list | fetch <url> | inspect <file> | hash <entry-file> | change <request.json> | export <id> <out.json> | schema <out.json>',
    );
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Catalog operation failed',
  );
  process.exitCode = 1;
}
