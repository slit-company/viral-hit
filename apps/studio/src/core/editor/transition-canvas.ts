import { radialMaskStops, transitionFrame, type TimelineTransitionKind, type TransitionLayer } from './transition-contract';

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function placeImage(context: Context2D, image: CanvasImageSource, layer: TransitionLayer, width: number, height: number) {
  context.save();
  context.translate(width / 2 + layer.dx * width, height / 2 + layer.dy * height);
  if (layer.scale !== 1) context.scale(layer.scale, layer.scale);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  context.restore();
}

function drawLayer(context: Context2D, image: CanvasImageSource, layer: TransitionLayer, width: number, height: number, scratch: Surface | null) {
  if (layer.weight <= 0) return;
  if (layer.mask.kind === 'radial') {
    const scratchContext = scratch?.getContext('2d') as Context2D | null | undefined;
    if (!scratch || !scratchContext) throw new Error('A radial transition needs a scratch canvas.');
    scratchContext.save();
    scratchContext.globalCompositeOperation = 'source-over';
    scratchContext.globalAlpha = 1;
    scratchContext.clearRect(0, 0, width, height);
    placeImage(scratchContext, image, layer, width, height);
    scratchContext.globalCompositeOperation = 'destination-in';
    const gradient = scratchContext.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.hypot(width / 2, height / 2));
    for (const stop of radialMaskStops(layer.mask.offset)) gradient.addColorStop(stop.radius, `rgba(0,0,0,${stop.alpha.toFixed(4)})`);
    scratchContext.fillStyle = gradient;
    scratchContext.fillRect(0, 0, width, height);
    scratchContext.restore();
    context.save();
    context.globalAlpha = layer.weight;
    context.drawImage(scratch, 0, 0, width, height);
    context.restore();
    return;
  }
  context.save();
  context.globalAlpha = layer.weight;
  if (layer.mask.kind === 'rect') {
    const { left, top, right, bottom } = layer.mask;
    context.beginPath();
    context.rect(left * width, top * height, Math.max(0, (1 - left - right) * width), Math.max(0, (1 - top - bottom) * height));
    context.clip();
  }
  placeImage(context, image, layer, width, height);
  context.restore();
}

/** Draw one transition frame from two full-frame (already letterboxed) layers. */
export function compositeTransitionFrame(
  context: Context2D,
  kind: TimelineTransitionKind,
  progress: number,
  outgoing: CanvasImageSource,
  incoming: CanvasImageSource,
  width: number,
  height: number,
  scratch: Surface | null = null
) {
  const frame = transitionFrame(kind, progress);
  context.save();
  context.globalCompositeOperation = 'source-over';
  context.globalAlpha = 1;
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  if (frame.blend === 'add') context.globalCompositeOperation = 'lighter';
  drawLayer(context, outgoing, frame.outgoing, width, height, scratch);
  drawLayer(context, incoming, frame.incoming, width, height, scratch);
  if (frame.white > 0) {
    context.globalAlpha = Math.min(1, frame.white);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
  }
  context.restore();
}
