import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { acceptProjectBundle } from '@/core/projects/bundles/import.server';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestTextWithLimit } from '@/lib/request-body-limit';
export async function POST({ request, params }: { request: Request; params: { bundleId: string } }) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  try {
    const body = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(await readRequestTextWithLimit(request, 4096)));
    return Response.json(await acceptProjectBundle(params.bundleId, body.sha256, AbortSignal.any([request.signal, AbortSignal.timeout(10 * 60_000)])), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Project import failed' }, { status: 400 }); }
}
export const Route = createFileRoute('/api/app/project-bundles/$bundleId/accept')({ server: { handlers: { POST } } });
