import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { commentAnchor } from '@/core/collaboration/contract';
import { changeCollaboration, readCollaboration } from '@/core/collaboration/service.server';
import { withToolErrors } from './tool-results';

// Agents read and answer review notes; creating or revoking share links stays with the owner.
const commentRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('comment'), body: z.string().trim().min(1).max(2000), anchor: commentAnchor.default({}) }).strict(),
  z.object({ action: z.literal('resolve'), commentId: z.string().uuid(), resolved: z.boolean().default(true) }).strict(),
]);

export function registerCollaborationTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_comments', {
    description: 'Review comments on a project from its owner, agents and people with a share link. list returns every comment with its author, body, anchor {time in timeline seconds, clipId, assetId} and whether it is settled, plus the active share links (role and label only). comment adds a note as the agent, optionally pinned to a timeline time or clip; resolve settles or reopens a comment after you have acted on it. Use list before editing to find what reviewers asked for, then apply changes with viral_hit_editor_edit. Share links are made and revoked by the owner in the app.',
    inputSchema: z.object({ projectId: z.string().min(1).max(128).optional(), request: commentRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withToolErrors(async ({ projectId, request }) => {
    const id = (await project(projectId)).id;
    if (request.action === 'list') return readCollaboration(id);
    return changeCollaboration(id, request, { kind: 'agent', name: 'Agent' });
  }));
}
