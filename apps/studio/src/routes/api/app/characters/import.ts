import { createFileRoute } from '@tanstack/react-router';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_CHARACTER_FILE_BYTES } from '@/core/characters/contract';
import { CharacterConflictError } from '@/core/characters/storage.server';
import { changeCharacters } from '@/core/characters/service.server';
import { validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';

/** Streams an uploaded character file to a private temporary file, imports it and removes the copy. */
export async function POST({ request }: { request: Request }) {
  const trust = validateTrustedWorkspaceMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  const type = request.headers.get('content-type')?.split(';')[0];
  if (type !== 'application/x-tar' && type !== 'application/octet-stream') return Response.json({ error: 'Upload a .viralhit-character.tar file' }, { status: 415 });
  if (Number(request.headers.get('content-length') ?? 0) > MAX_CHARACTER_FILE_BYTES) return Response.json({ error: 'Character files are limited to 20 images of up to 20 MB' }, { status: 413 });
  if (!request.body) return Response.json({ error: 'The character file is empty' }, { status: 400 });
  const directory = await mkdtemp(join(tmpdir(), 'vh-character-file-'));
  try {
    const path = join(directory, 'upload.tar');
    let received = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, done) {
      received += chunk.length;
      done(received > MAX_CHARACTER_FILE_BYTES ? new Error('Character files are limited to 20 images of up to 20 MB') : null, chunk);
    } });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5 * 60_000)]);
    await pipeline(Readable.fromWeb(request.body as import('node:stream/web').ReadableStream), limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal });
    return Response.json(await changeCharacters({ action: 'import' }, [], path), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: (error instanceof Error ? error.message : 'The character file could not be imported').slice(0, 500) }, { status: error instanceof CharacterConflictError ? 409 : 400 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const Route = createFileRoute('/api/app/characters/import')({ server: { handlers: { POST } } });
