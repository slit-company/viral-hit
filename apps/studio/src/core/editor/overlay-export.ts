import { overlayTransformAt } from './overlay-motion';
import { overlayOpacityAt, type TimelineClip } from './timeline-document';

export function drawImageOverlay(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  clip: TimelineClip,
  timelineTime: number,
  width: number,
  height: number
) {
  const pose = overlayTransformAt(clip, timelineTime);
  if (!pose) return;
  const opacity = overlayOpacityAt(clip, timelineTime);
  if (opacity <= 0) return;
  const drawWidth = width * pose.width;
  const drawHeight = drawWidth * (imageHeight / imageWidth);
  context.save();
  context.globalAlpha = opacity;
  context.translate(width * pose.x, height * pose.y);
  context.rotate((pose.rotation * Math.PI) / 180);
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

