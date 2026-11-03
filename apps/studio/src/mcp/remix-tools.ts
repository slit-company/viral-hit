import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { remixRequest } from '@/core/remix/contract';
import { changeRemix } from '@/core/remix/service.server';
import { withToolErrors } from './tool-results';

export function registerRemixTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_remix', {
    description: 'Remake a reference video\'s edit with new material. analyze queues local visual-cut detection on a project video (no credits) and returns a runId; list shows each analysis with its edit grammar: shot start/end/duration, average shot length and cuts per minute. build places the chosen project images/videos at the reference\'s exact cut times at the end of the timeline (cycling through them; a video too short for its shot leaves the rest black), optionally keeps the reference soundtrack as a music clip and joins shots with a transition. analyze also reads, locally, each shot\'s camera move (static, handheld, zoom/pan/tilt with amounts), freeze frames and pace changes, and on-screen text with its position when Tesseract is installed (readText: false skips text); list returns them per shot and grammar.edit.text says whether text was read. build with keepCamera (default true) gives still images in moving shots a covering overlay with the same zoom, pan or tilt; keepText copies the reference\'s on-screen text as editable captions at the same times and heights; keepSpeed (default true) repeats a shot\'s speed-up or slow-down on video material by playing the second half at 2× or 0.5× (freeze frames are reported, not applied). Everything stays editable.',
    inputSchema: z.object({ projectId: z.string().min(1).max(128).optional(), request: remixRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withToolErrors(async ({ projectId, request }) => changeRemix((await project(projectId)).id, request, 'mcp')));
}
