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
    description: 'List reviewed publication drafts, installed connector metadata schemas/destinations, load problems and observed delivery status in a project. Does not contact a provider or expose upload sessions.',
    inputSchema: z.object({ projectId: publicationProjectId.optional() }).strict(),
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, withToolErrors(async ({ projectId }) => safe(async () => listPublications((await project(projectId)).id))));
  server.registerTool('viral_hit_publication_change', {
    description: 'Prepare or revise a publication from local project media and a connected account or installed destination. For ext.* connectors use assetIds (ordered) and the advertised metadataSchema; supported media types and maxAssets come from publication_list. Instagram metadata.kind is reel (one MP4), story (one image or MP4), image (one image, optional altText) or carousel (2–20 ordered images/MP4s in assetIds, optional altTexts by position). Images are converted at draft time to the exact JPEG Meta downloads; frame "fill" crops to 4:5–1.91:1 (Stories 9:16), "fit" keeps the whole image over a blurred background, and carousel images share the first item\'s frame. Image formats need workspace R2/S3 storage with a public URL (imageHosting in publication_list). Approve/resume can start a real remote upload: require explicit human authorization of the displayed destination, media, metadata and visibility; pass confirmed=true only after that authorization. Approval binds the returned revision and digest. Stop cannot undo remote delivery. Reconcile only inspects the original upload; it does not resend bytes.',
    inputSchema: z.object({ projectId: publicationProjectId.optional(), request: publicationRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(async ({ projectId, request }) => safe(async () => changePublication((await project(projectId)).id, request, 'mcp'))));
}
