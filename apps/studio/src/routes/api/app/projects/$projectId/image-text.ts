import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { readImageText } from '@/core/studio/image-text.server';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit } from '@/lib/request-body-limit';

const body = z.object({ assetId: z.string().min(1).max(128) }).strict();

/** Reads the text in a project image (local OCR) for Studio's text editing tool. */
async function POST({ request, params }: { request: Request; params: { projectId: string } }) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  try {
    const { assetId } = body.parse(await readRequestJsonWithLimit(request, 4_000));
    return Response.json(await readImageText(params.projectId, assetId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : 'Text detection failed' }, { status: 400 });
  }
}
export const Route = createFileRoute('/api/app/projects/$projectId/image-text')({ server: { handlers: { POST } } });
