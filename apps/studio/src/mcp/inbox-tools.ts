import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { changeInbox, inboxOverview, inboxRequest } from '@/core/references/instagram-inbox-application.server';
import { withToolErrors } from './tool-results';

export function registerInboxTools(server: McpServer) {
  server.registerTool('viral_hit_instagram_inbox', {
    description: 'Collect videos people send to a connected Instagram professional account by DM (direct video attachments and shared Reels) into a project as references with sampled frames. status lists accounts, their project, whether 15-minute checks are on, the last check outcome and recently saved items; configure sets the project and turns checks on or off (expectedRevision from status, 0 for the first save); check asks the publication worker to check now. Uses the official Conversations API on the 20 most recent messages per conversation and needs instagram_manage_messages, pages_messaging and pages_manage_metadata in the Meta login configuration. Message text is never read or stored.',
    inputSchema: z.object({ request: z.union([z.object({ action: z.literal('status') }).strict(), inboxRequest]) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(async ({ request }) => request.action === 'status' ? inboxOverview() : changeInbox(request)));
}
