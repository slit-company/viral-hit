import type { McpServer } from '@modelcontextprotocol/server';
import { createReadStream } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { exportProjectBundle } from '@/core/projects/bundles/export.server';
import { inspectProjectBundle, acceptProjectBundle } from '@/core/projects/bundles/import.server';
import { withToolErrors } from './tool-results';
export function registerProjectBundleTools(server: McpServer) {
  server.registerTool('viral_hit_project_file_export', {
    description: 'Prepare a portable file of a saved project with verified local media, Canvas and timeline. Returns a local studio download URL. Does not publish or include credentials, live jobs or publishing approvals.',
    inputSchema: z.object({ projectId: z.string().min(1).max(160) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolErrors(async ({ projectId }) => exportProjectBundle(projectId)));
  server.registerTool('viral_hit_project_file_inspect', {
    description: 'Stage and verify a local .viralhit.tar file; return review ID, checksum and contents without creating a project.',
    inputSchema: z.object({ path: z.string().refine(isAbsolute, 'Use an absolute local file path') }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, withToolErrors(async ({ path }) => inspectProjectBundle(createReadStream(path))));
  server.registerTool('viral_hit_project_file_accept', {
    description: 'Import the inspected file into a new project using its review ID and exact checksum. Retry the same review after a lost acknowledgement; it returns the original imported project and never overwrites it.',
    inputSchema: z.object({ reviewId: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, withToolErrors(async ({ reviewId, sha256 }) => acceptProjectBundle(reviewId, sha256)));
}
