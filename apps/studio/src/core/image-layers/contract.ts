import { z } from 'zod';

/**
 * Image layer stacks: project images stacked bottom first, each with visibility, opacity, position and
 * size. A split model's layers or any project images make a stack. Flattening renders the visible layers
 * into a new project image; the layer images themselves never change.
 */
export const MAX_LAYERS = 16;
const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(80);
/** What a person or agent edits; each layer's pixel size is read from its image on the server. */
export const imageLayerInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  assetId: id,
  name,
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
  /** Top-left corner as a fraction of the canvas width and height. */
  x: z.number().min(-2).max(2),
  y: z.number().min(-2).max(2),
  /** Size relative to the layer image's own pixels; 1 keeps them. */
  scale: z.number().min(0.05).max(8),
}).strict();
export type ImageLayerInput = z.infer<typeof imageLayerInput>;
export type ImageLayer = ImageLayerInput & { width: number; height: number };
const layerList = z.array(imageLayerInput).min(1).max(MAX_LAYERS)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Layer IDs must be distinct');

export const imageLayersRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('get'), stackId: id }).strict(),
  /** From project images, bottom first, such as the layers of a split. The bottom image sets the canvas size. */
  z.object({ action: z.literal('create'), assetIds: z.array(id).min(1).max(MAX_LAYERS), name: name.optional() }).strict(),
  /** Replaces the layers and name. The revision must be the current one, so two editors never overwrite each other. */
  z.object({ action: z.literal('update'), stackId: id, revision: z.number().int().min(1), layers: layerList, name: name.optional() }).strict(),
  /** Renders the visible layers, bottom first, into one new PNG project image with transparency. */
  z.object({ action: z.literal('flatten'), stackId: id }).strict(),
  /** Removes the stack; its layer images and flattened images stay in the project. */
  z.object({ action: z.literal('delete'), stackId: id }).strict(),
]);
export type ImageLayersRequest = z.input<typeof imageLayersRequest>;

export type ImageLayerStack = {
  id: string; name: string; width: number; height: number; revision: number; layers: ImageLayer[];
  /** The image made by the last flatten, when it matches this revision. */
  flattenedAssetId: string | null; createdAt: number; updatedAt: number;
};
export type ImageLayerStackSummary = Pick<ImageLayerStack, 'id' | 'name' | 'width' | 'height' | 'revision' | 'updatedAt'> & { layerCount: number; coverAssetId: string };

/** A new layer showing a whole image at the canvas corner. */
export function newLayer(index: number, assetId: string, name: string): ImageLayerInput {
  return { id: 'layer-' + (index + 1), assetId, name: name.slice(0, 80) || 'Layer ' + (index + 1), visible: true, opacity: 1, x: 0, y: 0, scale: 1 };
}

/** Moves a layer one place toward the top (1) or the bottom (-1); unchanged at either end. */
export function moveLayer<T extends { id: string }>(layers: readonly T[], layerId: string, step: 1 | -1): T[] {
  const from = layers.findIndex(layer => layer.id === layerId), to = from + step;
  if (from < 0 || to < 0 || to >= layers.length) return [...layers];
  const next = [...layers];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** A free ID for a layer added to the stack. */
export function nextLayerId(layers: readonly { id: string }[]) {
  let index = layers.length + 1;
  while (layers.some(layer => layer.id === 'layer-' + index)) index++;
  return 'layer-' + index;
}

/** The layer's rectangle on the canvas in pixels, for previews and rendering alike. */
export function layerBox(layer: Pick<ImageLayer, 'x' | 'y' | 'scale' | 'width' | 'height'>, canvas: { width: number; height: number }) {
  return { left: Math.round(layer.x * canvas.width), top: Math.round(layer.y * canvas.height), width: Math.max(1, Math.round(layer.width * layer.scale)), height: Math.max(1, Math.round(layer.height * layer.scale)) };
}
