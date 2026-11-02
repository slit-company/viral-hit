import { changeInbox, inboxOverview, InboxRequestError } from '@/core/references/instagram-inbox-application.server';
import { readRequestJsonWithLimit } from '@/lib/request-body-limit';
import { validateTrustedWorkspaceJsonMutation, validateTrustedWorkspaceMutation } from '@/lib/trusted-local-request';
import { accountHeaders as headers } from './-account-policy.server';

const failure = (error: unknown) => error instanceof InboxRequestError
  ? Response.json({ error: error.message }, { status: error.code === 'not-found' ? 404 : error.code === 'conflict' ? 409 : 400, headers })
  : Response.json({ error: 'Instagram inbox settings are unavailable' }, { status: 503, headers });

/** Inbox status and settings behave like other workspace account data: trusted local requests only. */
export const instagramInboxHttp = {
  read(request: Request) {
    const trust = validateTrustedWorkspaceMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
    try { return Response.json(inboxOverview(), { headers }); } catch (error) { return failure(error); }
  },
  async change(request: Request) {
    const trust = validateTrustedWorkspaceJsonMutation(request);
    if (!trust.ok) return Response.json({ error: trust.message }, { status: trust.status, headers });
    try { return Response.json(await changeInbox(await readRequestJsonWithLimit(request, 4096)), { headers }); } catch (error) { return failure(error); }
  },
};
