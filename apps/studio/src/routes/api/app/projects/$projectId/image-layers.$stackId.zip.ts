import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createFileRoute } from '@tanstack/react-router';
import { changeImageLayers } from '@/core/image-layers/service.server';
import { zipStack } from '@/core/image-layers/render.server';

type Context = { params: { projectId: string; stackId: string } };

/** Streams the stack's layer images and their placement as one ZIP; nothing is stored in the project. */
async function GET({ params }: Context) {
  const directory = await mkdtemp(join(tmpdir(), 'vh-layer-zip-'));
  try {
    const { stack } = await changeImageLayers(params.projectId, { action: 'get', stackId: params.stackId }) as { stack: Parameters<typeof zipStack>[1] };
    const path = join(directory, 'layers.zip');
    const name = await zipStack(params.projectId, stack, path, AbortSignal.timeout(120_000));
    const stream = createReadStream(path);
    stream.on('close', () => { void rm(directory, { recursive: true, force: true }); });
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: {
      'Content-Type': 'application/zip', 'Content-Length': String((await stat(path)).size), 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="layers.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
    } });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 500) : 'Layer download failed' }, { status: error instanceof Error && /not found/i.test(error.message) ? 404 : 400 });
  }
}
export const Route = createFileRoute('/api/app/projects/$projectId/image-layers/$stackId/zip')({ server: { handlers: { GET } } });
