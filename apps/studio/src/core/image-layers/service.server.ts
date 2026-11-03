import { randomUUID } from 'node:crypto';
import { getActiveProject } from '../projects/projects';
import { getProjectAssetById } from '../workspace-lib/assets/user-assets';
import { imageLayersRequest, newLayer, type ImageLayer, type ImageLayerStack, type ImageLayerStackSummary } from './contract';
import { deleteStack, insertStack, listStacks, readStack, recordFlattened, updateStack } from './records.server';
import { flattenStack, layerImage } from './render.server';

/** Raised when the stack changed since it was read; the HTTP route answers 409. */
export class StackConflictError extends Error {}

const summary = (stack: ImageLayerStack): ImageLayerStackSummary => ({ id: stack.id, name: stack.name, width: stack.width, height: stack.height,
  revision: stack.revision, updatedAt: stack.updatedAt, layerCount: stack.layers.length, coverAssetId: stack.flattenedAssetId ?? stack.layers[stack.layers.length - 1].assetId });

function found(projectId: string, stackId: string) {
  const stack = readStack(projectId, stackId);
  if (!stack) throw Error('Layer stack not found');
  return stack;
}

/** Lists, creates, edits, flattens and removes a project's image layer stacks, for the UI and agents alike. */
export async function changeImageLayers(projectId: string, raw: unknown) {
  const request = imageLayersRequest.parse(raw);
  if (!await getActiveProject({ projectId })) throw Error('Project not found');
  const signal = AbortSignal.timeout(180_000);
  switch (request.action) {
    case 'list': return { stacks: listStacks(projectId).map(summary) };
    case 'get': return { stack: found(projectId, request.stackId) };
    case 'create': {
      const images = await Promise.all(request.assetIds.map(assetId => layerImage(projectId, assetId, signal)));
      const now = Date.now(), stack: ImageLayerStack = {
        id: randomUUID(), name: request.name ?? 'Layer stack', width: images[0].width, height: images[0].height, revision: 1, flattenedAssetId: null, createdAt: now, updatedAt: now,
        layers: request.assetIds.map((assetId, index) => ({ ...newLayer(index, assetId, 'Layer ' + (index + 1)), width: images[index].width, height: images[index].height })),
      };
      insertStack(projectId, stack);
      return { stack };
    }
    case 'update': {
      const current = found(projectId, request.stackId);
      if (current.revision !== request.revision) throw new StackConflictError('These layers changed in another window. Reload to see the latest version.');
      // Pixel sizes come from the images: kept for layers that still show the same image, read for replaced ones.
      const known = new Map(current.layers.map(layer => [layer.assetId, layer]));
      const layers: ImageLayer[] = [];
      for (const layer of request.layers) {
        const same = known.get(layer.assetId);
        const size = same ?? await layerImage(projectId, layer.assetId, signal);
        layers.push({ ...layer, width: size.width, height: size.height });
      }
      if (!updateStack(projectId, current.id, request.revision, request.name ?? current.name, layers)) throw new StackConflictError('These layers changed in another window. Reload to see the latest version.');
      return { stack: found(projectId, current.id) };
    }
    case 'flatten': {
      const stack = found(projectId, request.stackId);
      const existing = stack.flattenedAssetId && await getProjectAssetById({ projectId, assetId: stack.flattenedAssetId });
      const assetId = existing ? stack.flattenedAssetId! : await flattenStack(projectId, stack, signal);
      recordFlattened(projectId, stack.id, stack.revision, assetId);
      const asset = await getProjectAssetById({ projectId, assetId });
      return { assetId, publicUrl: asset?.publicUrl ?? null, revision: stack.revision };
    }
    case 'delete': {
      if (!deleteStack(projectId, request.stackId)) throw Error('Layer stack not found');
      return { deleted: request.stackId };
    }
  }
}
