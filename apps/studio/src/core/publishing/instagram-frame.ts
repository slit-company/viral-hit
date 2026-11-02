/** Meta image limits, inspected 2026-11-03: JPEG, 8 MB, 4:5 to 1.91:1, width 320–1440 (rescaled by Meta). */
export const INSTAGRAM_FEED_RATIO = { min: 4 / 5, max: 1.91 } as const;
export const INSTAGRAM_STORY_RATIO = 9 / 16;
export const INSTAGRAM_IMAGE_MAX_BYTES = 8_000_000;
export const INSTAGRAM_FEED_MAX_WIDTH = 1440;
export const INSTAGRAM_STORY_MAX_WIDTH = 1080;

export type InstagramImagePlan = {
  width: number; height: number; frame: 'fill' | 'fit';
  /** Source rectangle kept by fill; null keeps the whole picture. */
  crop: { width: number; height: number; x: number; y: number } | null;
};
export const feedRatio = (width: number, height: number) => Math.min(INSTAGRAM_FEED_RATIO.max, Math.max(INSTAGRAM_FEED_RATIO.min, width / height));
const even = (value: number) => Math.max(2, 2 * Math.round(value / 2));

/**
 * Exact output geometry for one image. Fill crops the centre to the frame; fit keeps the whole picture.
 * Dimensions are even, never wider than maxWidth, and a feed frame stays inside Meta's ratio range after rounding.
 */
export function planInstagramImage(source: { width: number; height: number }, ratio: number, frame: 'fill' | 'fit', maxWidth: number, feed = true): InstagramImagePlan {
  if (![source.width, source.height, ratio, maxWidth].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid image geometry');
  let crop: InstagramImagePlan['crop'] = null, base: number;
  if (frame === 'fill') {
    const cropWidth = source.width / source.height > ratio ? Math.round(source.height * ratio) : source.width;
    const cropHeight = source.width / source.height > ratio ? source.height : Math.round(source.width / ratio);
    if (Math.abs(cropWidth - source.width) > 1 || Math.abs(cropHeight - source.height) > 1) crop = { width: cropWidth, height: cropHeight, x: Math.floor((source.width - cropWidth) / 2), y: Math.floor((source.height - cropHeight) / 2) };
    base = crop?.width ?? source.width;
  } else base = Math.max(source.width, source.height * ratio);
  const width = even(Math.min(maxWidth, base) - 1);
  let height = even(width / ratio);
  if (feed) {
    while (width / height < INSTAGRAM_FEED_RATIO.min) height -= 2;
    while (width / height > INSTAGRAM_FEED_RATIO.max) height += 2;
  }
  return { width, height, frame, crop };
}
