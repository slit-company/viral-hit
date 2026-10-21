import { changeStoryboards } from '@/core/storyboards/service.server';
import { MAX_STORYBOARD_BYTES, storyboardRequest } from '@/core/storyboards/contract';
import { StoryboardConflict, readAction } from '@/core/storyboards/storage.server';
import { validateTrustedWorkspaceJsonMutation } from '@/lib/trusted-local-request';
import { readRequestJsonWithLimit, RequestBodyTooLargeError } from '@/lib/request-body-limit';
export async function storyboardsGet(projectId: string) {
  try { return Response.json(await changeStoryboards(projectId, { action: 'list' }), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Project not found' }, { status: 404 }); }
}
export async function storyboardsPost(projectId: string, request: Request) {
  const trust = validateTrustedWorkspaceJsonMutation(request);
  if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status });
  let body: unknown;
  try {
    body = await readRequestJsonWithLimit(request, MAX_STORYBOARD_BYTES);
    return Response.json(await changeStoryboards(projectId, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const parsed = storyboardRequest.safeParse(body);
    let reserved: boolean | undefined;
    if (parsed.success && (parsed.data.action === 'generate' || parsed.data.action === 'assemble')) {
      try { reserved = !!readAction(projectId, parsed.data.id, parsed.data.requestId); }
      catch { /* An unavailable ledger cannot establish rejection. */ }
    }
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 1000) : 'Storyboard request failed', ...(reserved === undefined ? {} : { reserved }) },
      { status: error instanceof StoryboardConflict ? 409 : error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
}
