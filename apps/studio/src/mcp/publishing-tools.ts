import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { changePublication, listPublications } from '../core/publishing/application.server';
import { publicationProjectId, publicationRequest, PublicationRequestError } from '../core/publishing/requests';
import { withToolErrors } from './tool-results';

async function safe<T>(operation: () => Promise<T>) {
  try { return await operation(); }
  catch (error) { throw error instanceof PublicationRequestError ? error : new Error('Publication service unavailable; select an active project and review its current state'); }
}

export function registerPublishingTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_publication_list', {
    description: 'List reviewed publication drafts and observed delivery status in a project. Does not contact a provider or expose upload sessions.',
    inputSchema: z.object({ projectId: publicationProjectId.optional() }).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, withToolErrors(async ({ projectId }) => safe(async () => listPublications((await project(projectId)).id))));
  server.registerTool('viral_hit_publication_change', {
    description: 'Prepare or revise a publication from a local project video and connected account. Approve/resume can start a real remote upload: require explicit human authorization of the displayed destination, video, metadata and visibility; pass confirmed=true only after that authorization. Approval binds the returned revision and digest. Stop cannot undo remote delivery. Reconcile only inspects the original upload; it does not resend bytes.',
    inputSchema: z.object({ projectId: publicationProjectId.optional(), request: publicationRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(async ({ projectId, request }) => safe(async () => changePublication((await project(projectId)).id, request, 'mcp'))));
}
