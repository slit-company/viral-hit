import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { creativePackBuildSchema, creativePackUpdateOptions, MAX_CREATIVE_PACK_BYTES } from '@/core/creative-packs/contract';
import { CreativePackConflictError } from '@/core/creative-packs/storage.server';
import { changeCreativePacks } from '@/core/creative-packs/service.server';
import { validateTrustedWorkspaceMutation, validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit } from '@/lib/request-body-limit';

const downloadRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('history'), id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/) }).strict(),
  z.object({ action: z.literal('review-remove'), id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/) }).strict(),
  z.object({ action: z.literal('remove'), id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), expectedStateDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('build'), pack: creativePackBuildSchema }).strict(),
  z.object({ action: z.literal('export'), id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), digest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ action: z.literal('fetch'), expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), url: z.string().url().max(2000) }).strict(),
]);
const failure = (error: unknown) => Response.json({ error: (error instanceof Error ? error.message : 'Could not read creative pack').slice(0, 1000) }, { status: error instanceof CreativePackConflictError ? 409 : 400 });
export async function downloadPack(request: Request) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  const directory = await mkdtemp(join(tmpdir(), 'vh-pack-download-'));
  try {
    const input = downloadRequest.parse(await readRequestJsonWithLimit(request, 32_000));
    if (input.action === 'history' || input.action === 'review-remove' || input.action === 'remove') {
      const result = await changeCreativePacks(input); await rm(directory, { recursive: true, force: true });
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    const id = input.action === 'build' ? input.pack.id : input.action === 'export' ? input.id : 'shared-pack', path = join(directory, id + '.tar');
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5 * 60_000)]);
    const written = await changeCreativePacks({ ...input, path }, signal) as { sizeBytes: number };
    const stream = createReadStream(path, { signal });
    stream.once('close', () => { void rm(directory, { recursive: true, force: true }); });
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: { 'Content-Type': 'application/x-tar', 'Content-Length': String(written.sizeBytes),
      'Content-Disposition': 'attachment; filename="' + id + '.viralhit-pack.tar"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { await rm(directory, { recursive: true, force: true }); return failure(error); }
}
export async function uploadPack(request: Request) {
  const trust = validateTrustedWorkspaceMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  const query = new URL(request.url).searchParams, action = query.get('action'), digest = query.get('digest');
  if (!['inspect', 'install', 'update'].includes(action ?? '') || (action !== 'inspect' && !/^[a-f0-9]{64}$/.test(digest ?? ''))) return failure(new Error('Choose inspect, install or update with the reviewed digest'));
  if (!['application/x-tar', 'application/octet-stream'].includes(request.headers.get('content-type')?.split(';')[0] ?? '')) return new Response('Upload a .viralhit-pack.tar file', { status: 415 });
  if (!request.body || Number(request.headers.get('content-length') ?? 0) > MAX_CREATIVE_PACK_BYTES) return failure(new Error('Upload a pack up to 512 MB'));
  const directory = await mkdtemp(join(tmpdir(), 'vh-pack-upload-'));
  try {
    const header = request.headers.get('x-viral-hit-pack-update') ?? '';
    if (header.length > 8192) throw new Error('Pack update choices exceed 8 KB');
    const update = action === 'update' ? creativePackUpdateOptions.parse(JSON.parse(header)) : undefined;
    const path = join(directory, 'upload.tar'); let received = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, done) { received += chunk.length; done(received > MAX_CREATIVE_PACK_BYTES ? new Error('Creative packs must be 512 MB or smaller') : null, chunk); } });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5 * 60_000)]);
    await pipeline(Readable.fromWeb(request.body as import('node:stream/web').ReadableStream), limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal });
    return Response.json(await changeCreativePacks(action === 'inspect' ? { action, path } : update ? { action: 'update', path, expectedDigest: digest!, ...update } : { action: 'install', path, expectedDigest: digest! }, signal), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
