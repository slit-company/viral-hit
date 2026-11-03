import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { characterSwapRequest } from '@/core/character-swap/contract';
import { changeCharacterSwaps } from '@/core/character-swap/service.server';
import { withToolErrors } from './tool-results';

export function registerCharacterSwapTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_character_swap', {
    description: 'Swap the person in a timeline video clip for a character while keeping the clip\'s body movement, head turns, expressions, timing, camera, framing, background and light. Uses a reference-to-video model (one taking a reference video and reference images; MiniMax H3 references is the strongest) with a prompt that assigns identity to the images and everything else to the video. plan (clipId, modelId, characterId or imageAssetIds, notes?) returns the pieces (clips over 15 seconds are cut into even pieces of 2 to 15 seconds), the prompt and the estimated cost without spending. produce (same plus requestId) cuts the pieces and queues one paid generation per piece as a durable run. list shows swaps with each piece\'s state and result. evaluate (requestId) is local and free: OpenCV face matching compares each result with the character and with the original person; verdict swapped, blended (resembles both), kept (still the original) or unclear (no faces). place (requestId) puts the results on the clip as takes, split where pieces meet, keeping the original sound on an audio track unless keepSound was false.',
    inputSchema: z.object({ projectId: z.string().min(1).max(128).optional(), request: characterSwapRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(async ({ projectId, request }) => changeCharacterSwaps((await project(projectId)).id, request, 'mcp')));
}
