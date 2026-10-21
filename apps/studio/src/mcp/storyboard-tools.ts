import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { storyboardRequest } from '@/core/storyboards/contract';
import { changeStoryboards } from '@/core/storyboards/service.server';
import { withToolErrors } from './tool-results';
export function registerStoryboardTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_storyboard', {
    description: 'Author general or specialized project storyboards from owned references. Save versioned observations, shot directions, timing, captions and exact recipe values/digests. Distinguish observed/inferred/proposed evidence; no automatic visual understanding is claimed. Generate explicitly selected shots through existing recipes; this may spend provider credits, so use only within the authorized production scope. A stable requestId resumes the original pinned attempt after failure, never silently generates a replacement. Accept only inspected local media or a matching succeeded generation with honest review notes. Edits invalidate affected acceptance. Assemble current accepted shots into an editable-sequence run, then use normal runs/attachment tools with the current timeline revision. No automatic publishing. Read returns action IDs, job status and retained revision data.',
    inputSchema: z.object({ projectId: z.string().min(1).max(128).optional(), request: storyboardRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(async ({ projectId, request }) => changeStoryboards((await project(projectId)).id, request)));
}
