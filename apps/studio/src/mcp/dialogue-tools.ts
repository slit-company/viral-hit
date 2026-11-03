import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { dialogueRequest } from '@/core/dialogue/contract';
import { changeDialogues } from '@/core/dialogue/service.server';
import { withToolErrors } from './tool-results';

export function registerDialogueTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_dialogue', {
    description: 'Voice a conversation with a different voice per speaker. produce takes a script of "Name: words" lines (up to 40; a line without a name continues the previous one), a text-to-speech modelId and cast {speaker: voice} using the model\'s voice_id or voice option (see viral_hit_generation_model_get), and queues one generation per line as a durable run (paid; follows the ask-before-generating setting). list shows each dialogue with every line\'s speaker, voice, state and finished audio. place puts the finished lines on the timeline one after another as voice clips after the last voice already there (gap seconds between them, default 0.3), so music ducks under them, and turns measured word timing into captions unless captions is false.',
    inputSchema: z.object({ projectId: z.string().min(1).max(128).optional(), request: dialogueRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(async ({ projectId, request }) => changeDialogues((await project(projectId)).id, request, 'mcp')));
}
