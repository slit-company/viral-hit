import { MAX_STORYBOARD_BYTES } from '../src/core/storyboards/contract';
import { changeStoryboards } from '../src/core/storyboards/service.server';
try {
  const projectId = process.argv[2];
  if (!projectId || process.argv.length !== 3) throw Error('Usage: pnpm storyboard <projectId> < request.json');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > MAX_STORYBOARD_BYTES) throw Error('Storyboard request exceeds 256 KB');
    chunks.push(bytes);
  }
  console.log(JSON.stringify(await changeStoryboards(projectId, JSON.parse(Buffer.concat(chunks).toString('utf8'))), null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : 'Storyboard command failed'); process.exitCode = 1; }
