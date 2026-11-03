import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { shapeshiftRequest } from '@/core/shapeshift/contract';
import { changeShapeshifts } from '@/core/shapeshift/service.server';
import { withToolErrors } from './tool-results';

export function registerShapeshiftTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_shapeshift', {
    description: 'Rebuild part of a project video while its motion, timing, camera and sound stay as shot. mode motion-transfer keeps only the movement and builds a new scene around the character from the pictures (style can redraw everything as anime, claymation, comic and more); object-swap replaces exactly one subject (person, product, outfit) and keeps the rest of the shot. models (mode) lists models that can run the mode, best first: services that reported credit, then a dedicated performance or replacement model, video editors, then reference-to-video models; spends nothing. plan (mode, sourceAssetId, optional start/end seconds, imageAssetIds with the main picture first and/or characterId, style, prompt, modelId auto or a model, quality 480p/720p/1080p, variations 1-3, keepSound) returns the models, the pieces (sources longer than a model makes in one go are cut into even pieces), the prompts and the estimate. With auto, each variation runs a different model family. produce (same plus requestId) cuts the pieces and queues every paid generation as one durable run. list shows runs with each piece\'s state. finish (requestId) is local and free: it joins each finished variation into one video with the source\'s exact length, framing and sound, then scores motion (frame-by-frame motion compared with the source) and face (OpenCV face match with the pictures and with the original person) and marks the best variation. Results are project videos for the editor timeline.',
    inputSchema: z.object({ projectId: z.string().min(1).max(128).optional(), request: shapeshiftRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, withToolErrors(async ({ projectId, request }) => changeShapeshifts((await project(projectId)).id, request)));
}
