import { changePublication, listPublications } from '../src/core/publishing/application.server';
import { publicationProjectId, PublicationRequestError } from '../src/core/publishing/requests';

const usage = 'Usage: pnpm publication --project ID list | pnpm publication --project ID change < request.json';
try {
  const [flag, id, action, ...extra] = process.argv.slice(2);
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
  console.error(error instanceof PublicationRequestError || (error instanceof Error && error.message === usage) ? error.message : 'Publication operation failed');
  process.exitCode = 1;
}
