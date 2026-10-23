/** Browser helpers for the mask painter. The overlay is painted white and shown with an inverting blend so it contrasts with any image; export turns any painted pixel white. */
export const MASK_OVERLAY_COLOR = 'rgb(255, 255, 255)';
const MAX_MASK_SIDE = 1024;

/** Masks are stretched to the source size by the server, so a bounded drawing surface keeps memory low. */
export function maskCanvasSize(width: number, height: number) {
  const scale = Math.min(1, MAX_MASK_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function paintStroke(context: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, size: number, erase: boolean) {
  context.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  context.strokeStyle = MASK_OVERLAY_COLOR;
  context.lineWidth = size; context.lineCap = 'round'; context.lineJoin = 'round';
  context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke();
}

/** Shows an existing black-and-white mask as overlay paint so it can be edited again. */
export function drawMaskAsOverlay(context: CanvasRenderingContext2D, image: CanvasImageSource) {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const marked = pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2] > 382;
    pixels.data.set(marked ? [255, 255, 255, 255] : [0, 0, 0, 0], i);
  }
  context.putImageData(pixels, 0, 0);
}

/** Returns null when nothing is painted. */
export async function exportMask(overlay: HTMLCanvasElement) {
  const source = overlay.getContext('2d')!.getImageData(0, 0, overlay.width, overlay.height);
  const output = new ImageData(overlay.width, overlay.height);
  let painted = false;
  for (let i = 0; i < source.data.length; i += 4) {
    const value = source.data[i + 3] > 0 ? 255 : 0;
    painted ||= value > 0;
    output.data.set([value, value, value, 255], i);
  }
  if (!painted) return null;
  const canvas = document.createElement('canvas');
  canvas.width = overlay.width; canvas.height = overlay.height;
  canvas.getContext('2d')!.putImageData(output, 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('Mask could not be encoded')), 'image/png'));
}
