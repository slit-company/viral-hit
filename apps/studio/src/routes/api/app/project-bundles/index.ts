import { createFileRoute } from '@tanstack/react-router';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { exportProjectBundle } from '@/core/projects/bundles/export.server';
import { inspectProjectBundle } from '@/core/projects/bundles/import.server';
import { MAX_BUNDLE_BYTES } from '@/core/projects/bundles/contract';
import { validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';
import { readRequestTextWithLimit } from '@/lib/request-body-limit';

export async function POST({ request }: { request: Request }) {
  const trust = validateTrustedWorkspaceMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10 * 60_000)]);
  try {
    const type = request.headers.get('content-type')?.split(';')[0];
    if (type === 'application/json') {
      const body = z.object({ projectId: z.string().min(1).max(160) }).strict().parse(JSON.parse(await readRequestTextWithLimit(request, 4096)));
      return Response.json(await exportProjectBundle(body.projectId, signal), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (type !== 'application/x-tar' && type !== 'application/octet-stream') return Response.json({ error: 'Upload a .viralhit.tar project file' }, { status: 415 });
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BUNDLE_BYTES) return Response.json({ error: 'Project file exceeds 2 GiB' }, { status: 413 });
    if (!request.body) throw Error('Project file is empty');
    const stream = Readable.fromWeb(request.body as import('node:stream/web').ReadableStream, { signal });
    try { return Response.json(await inspectProjectBundle(stream, signal), { headers: { 'Cache-Control': 'no-store' } }); }
    finally { stream.destroy(); }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Project file could not be prepared' }, { status: 400 });
  }
}
export const Route = createFileRoute('/api/app/project-bundles/')({ server: { handlers: { POST } } });
