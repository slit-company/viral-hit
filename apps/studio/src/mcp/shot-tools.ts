import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { shotRequest } from '@/core/shot-harness/contract';
import { changeShots } from '@/core/shot-harness/service.server';
import { withToolErrors } from './tool-results';

export function registerShotTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_shot', {
    description: 'Direct cinematic video shots and multi-shot sequences. preview turns a shot description (subject, action, setting, camera moves, framing, lens, light, look, audio, duration, aspect ratio, characters) into the chosen still and video models, model-specific prompts and settings without spending credits. produce queues the still and every take as one durable run (paid; needs the user\'s approval); optional sequence {id, shotId?, continuesFrom?} places it in a sequence: a new shotId-less run goes after the last shot, reusing shotId adds another attempt of that shot. continue extracts a finished take\'s last frame as a project image (same image for the same take) to use as the next shot\'s startAssetId. list shows runs with sequence, position, attempt, stored spec and takes; quality decodes a take and reports frozen, black, cut, silent or low-resolution problems.',
    inputSchema: z.object({ projectId: z.string().min(1).max(128).optional(), request: shotRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(async ({ projectId, request }) => changeShots((await project(projectId)).id, request)));
}
