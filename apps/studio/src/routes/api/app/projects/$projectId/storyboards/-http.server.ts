import { changeStoryboards } from '@/core/storyboards/service.server';
import { MAX_STORYBOARD_BYTES } from '@/core/storyboards/contract';
import { StoryboardConflict } from '@/core/storyboards/storage.server';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';
export async function storyboardsGet(projectId: string) {
  try { return Response.json(await changeStoryboards(projectId, { action: 'list' }), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Project not found' }, { status: 404 }); }
}
export async function storyboardsPost(projectId: string, request: Request) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  try {
    const body = await readRequestJsonWithLimit(request, MAX_STORYBOARD_BYTES);
    return Response.json(await changeStoryboards(projectId, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 1000) : 'Storyboard request failed' },
      { status: error instanceof StoryboardConflict ? 409 : error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
}
