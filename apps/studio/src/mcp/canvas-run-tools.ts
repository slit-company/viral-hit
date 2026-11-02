import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { canvasRunRequest, changeCanvasRuns } from '@/core/creative-canvas/canvas-runs.server';
import { withToolErrors } from './tool-results';

export function registerCanvasRunTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_canvas_run', {
    description: 'Run a chain of Canvas generation cards and branch it. plan (cardId) lists the card and every generation card it depends on, in order, each marked run (no result yet, settings changed, inputs changed, or an input it uses runs first) or reuse (its pinned result is current). start (cardId, requestId) queues only the steps that must run as one durable run; identical steps reuse earlier results without a new paid request, and takes appear on the canvas as the run progresses (paid; needs the user\'s approval). status brings takes up to date and lists recent runs. branch (cardId, requestId) copies a card and every generation card downstream of it below the originals, sharing their inputs, so a variation can be edited and run without touching the original.',
    inputSchema: z.object({ projectId: z.string().min(1).max(128).optional(), request: canvasRunRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(async ({ projectId, request }) => changeCanvasRuns((await project(projectId)).id, request, 'mcp')));
}
