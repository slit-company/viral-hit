import { createFileRoute } from '@tanstack/react-router';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { characterId } from '@/core/characters/contract';
import { changeCharacters } from '@/core/characters/service.server';

/** Downloads one character as a file; the temporary copy is removed once the response ends. */
export async function GET({ request, params }: { request: Request; params: { characterId: string } }) {
  const site = request.headers.get('sec-fetch-site'), origin = request.headers.get('origin');
  if ((site && site !== 'same-origin' && site !== 'none') || (origin && origin !== new URL(request.url).origin)) return new Response('Cross-site request rejected', { status: 403 });
  const id = characterId.safeParse(params.characterId);
  if (!id.success) return Response.json({ error: 'Character not found' }, { status: 404 });
  const directory = await mkdtemp(join(tmpdir(), 'vh-character-file-'));
  try {
    const path = join(directory, id.data + '.viralhit-character.tar');
    const written = await changeCharacters({ action: 'export', id: id.data, path }) as { sizeBytes: number };
    const stream = createReadStream(path);
    const cleanup = () => { void rm(directory, { recursive: true, force: true }); };
    stream.once('close', cleanup);
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: {
      'Content-Type': 'application/x-tar', 'Content-Length': String(written.sizeBytes),
      'Content-Disposition': 'attachment; filename="' + id.data + '.viralhit-character.tar"',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    return Response.json({ error: error instanceof Error && error.message === 'Character not found' ? error.message : 'The character file could not be prepared' }, { status: error instanceof Error && error.message === 'Character not found' ? 404 : 500 });
  }
}

export const Route = createFileRoute('/api/app/characters/$characterId/file')({ server: { handlers: { GET } } });
