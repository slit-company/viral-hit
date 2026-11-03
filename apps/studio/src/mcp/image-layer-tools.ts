import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { imageLayersRequest } from '@/core/image-layers/contract';
import { changeImageLayers } from '@/core/image-layers/service.server';
import { withToolErrors } from './tool-results';

export function registerImageLayerTools(server: McpServer, project: (projectId?: string) => Promise<{ id: string }>) {
  server.registerTool('viral_hit_image_layers', {
    description: 'Edit an image as a stack of layers. create (assetIds bottom first, name?) stacks project images; the bottom image sets the canvas size. A split-into-layers model (Studio tool image-layers) returns the layers of one picture as separate transparent images, which make a natural stack. list and get (stackId) show stacks; each layer has id, assetId, name, visible, opacity 0-1, x and y (top-left corner as a fraction of the canvas), scale (of the layer image\'s own pixels) and its pixel width and height. update (stackId, revision, layers, name?) replaces the layers and must carry the current revision; replace a layer\'s assetId with an edited image to swap it. flatten (stackId) renders the visible layers into one new PNG project image with transparency and returns its assetId. delete removes the stack and keeps every image. Layers can also be downloaded as a ZIP from /api/app/projects/{projectId}/image-layers/{stackId}/zip.',
    inputSchema: z.object({ projectId: z.string().min(1).max(128).optional(), request: imageLayersRequest }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, withToolErrors(async ({ projectId, request }) => changeImageLayers((await project(projectId)).id, request)));
}
