import { createFileRoute } from '@tanstack/react-router';
import { ZodError } from 'zod';
import { changeCharacterSwaps } from '@/core/character-swap/service.server';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';

type Context = { request: Request; params: { projectId: string } };
const failure = (error: unknown) => Response.json({ error: error instanceof ZodError ? 'Invalid character swap request' : error instanceof Error ? error.message.slice(0, 500) : 'Character swap failed' },
  { status: error instanceof RequestBodyTooLargeError ? 413 : error instanceof Error && /not found/i.test(error.message) ? 404 : 400 });

async function GET({ params, request }: Context) {
  const clipId = new URL(request.url).searchParams.get('clipId') ?? undefined;
  try { return Response.json(await changeCharacterSwaps(params.projectId, { action: 'list', ...(clipId ? { clipId } : {}) }, 'ui'), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
async function POST({ params, request }: Context) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  try { return Response.json(await changeCharacterSwaps(params.projectId, await readRequestJsonWithLimit(request, 32_000), 'ui'), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return failure(error); }
}
export const Route = createFileRoute('/api/app/projects/$projectId/character-swaps')({ server: { handlers: { GET, POST } } });
