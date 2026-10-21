import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { connectorManifestSchema } from '../src/core/publishing/installed/contract';
import { installedConnectorCatalog, readConnectorFolder } from '../src/core/publishing/installed/catalog.server';
import { changePublication, listPublications } from '../src/core/publishing/application.server';
import { publicationProjectId, PublicationRequestError } from '../src/core/publishing/requests';

const usage = 'Usage: publication --project ID list|change | connectors | check-connector <folder> | connector-schema <out.json>';
try {
  const [flag, id, action, ...extra] = process.argv.slice(2);
  if (flag === 'connectors') { console.log(JSON.stringify(installedConnectorCatalog(), null, 2)); process.exit(0); }
  if (flag === 'check-connector' && id) { console.log(JSON.stringify(readConnectorFolder(resolve(id)).descriptor, null, 2)); process.exit(0); }
  if (flag === 'connector-schema' && id) { await writeFile(resolve(id), JSON.stringify(z.toJSONSchema(connectorManifestSchema, { io: 'input' }), null, 2) + '\n', { flag: 'wx' }); process.exit(0); }
  if (flag !== '--project' || !publicationProjectId.safeParse(id).success || !['list', 'change'].includes(action) || extra.length) throw new Error(usage);
  let result;
  if (action === 'list') result = await listPublications(id);
  else {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.from(chunk); size += buffer.length;
      if (size > 32000) throw new PublicationRequestError('invalid-input', 'Publication request exceeds 32 KB');
      chunks.push(buffer);
    }
    let request: unknown;
    try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new PublicationRequestError('invalid-input', 'Invalid publication JSON'); }
    result = await changePublication(id, request, 'cli');
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (process.argv[2] === 'check-connector') { console.error(error instanceof z.ZodError ? error.issues.slice(0, 6).map(issue => issue.path.join('.') + ': ' + issue.message).join('\n') : error instanceof Error ? error.message : 'Invalid connector'); process.exit(1); }
  console.error(error instanceof PublicationRequestError || (error instanceof Error && error.message === usage) ? error.message : 'Publication operation failed');
  process.exitCode = 1;
}
