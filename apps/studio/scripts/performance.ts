import { changePerformance, readPerformance, readPublicationPerformance } from '../src/core/measurement/application.server';
import { MeasurementRequestError } from '../src/core/measurement/contract';
import { publicationProjectId } from '../src/core/publishing/requests';

const usage = 'Usage: performance --project ID list | history PUBLICATION_ID | collect PUBLICATION_ID | record < request.json';
try {
  const [flag, id, action, target, ...extra] = process.argv.slice(2);
  if (flag !== '--project' || !publicationProjectId.safeParse(id).success || extra.length) throw new Error(usage);
  let result;
  if (action === 'list' && !target) result = await readPerformance(id);
  else if (action === 'history' && target) result = await readPublicationPerformance(id, { publicationId: target });
  else if (action === 'collect' && target) result = await changePerformance(id, { action: 'collect', publicationId: target }, 'cli');
  else if (action === 'record' && !target) {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.from(chunk); size += buffer.length;
      if (size > 16000) throw new MeasurementRequestError('invalid-input', 'Performance request exceeds 16 KB');
      chunks.push(buffer);
    }
    let request: unknown;
    try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new MeasurementRequestError('invalid-input', 'Invalid performance JSON'); }
    result = await changePerformance(id, { ...(request as object), action: 'record' }, 'cli');
  } else throw new Error(usage);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof MeasurementRequestError || (error instanceof Error && error.message === usage) ? error.message : 'Performance operation failed');
  process.exitCode = 1;
}
