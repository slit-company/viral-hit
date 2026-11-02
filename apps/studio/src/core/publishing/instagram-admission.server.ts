import type { PublicationAsset } from './contracts';
import { INSTAGRAM_CAROUSEL_LIMIT, instagramMetadataSchema, type InstagramMetadata } from './instagram-contract';
import { INSTAGRAM_FEED_MAX_WIDTH, INSTAGRAM_STORY_MAX_WIDTH, INSTAGRAM_STORY_RATIO, feedRatio, planInstagramImage } from './instagram-frame';
import { probeInstagramImage, renderInstagramJpeg } from './instagram-image.server';
import { validateInstagramVideo } from './instagram-video.server';
import type { openProjectPublicationMedia } from './project-media.server';
import { openPublicImageHost } from './public-image-host.server';
import { PublicationRequestError } from './requests';

type Media = ReturnType<typeof openProjectPublicationMedia>;
const STORAGE_REQUIRED = 'Instagram downloads images from a public link. Connect R2 or S3 storage with a public URL in API settings → Storage, then try again.';

function allowed(metadata: InstagramMetadata, types: string[]) {
  const image = (type: string) => type === 'image', video = (type: string) => type === 'video';
  if (metadata.kind === 'carousel') {
    if (types.length < 2 || types.length > INSTAGRAM_CAROUSEL_LIMIT) return 'Choose 2 to 20 images or videos for a carousel.';
    if (!types.every(type => image(type) || video(type))) return 'Carousels accept images and MP4 videos.';
    if ((metadata.altTexts?.length ?? 0) > types.length || (metadata.altTexts ?? []).some((text, index) => text && !image(types[index]))) return 'Alt text applies to carousel images only.';
    return null;
  }
  if (types.length !== 1) return 'Choose one file for this Instagram format.';
  if (metadata.kind === 'reel' && !video(types[0])) return 'Reels need an MP4 video.';
  if (metadata.kind === 'image' && !image(types[0])) return 'Image posts need an image.';
  if (metadata.kind === 'story' && !image(types[0]) && !video(types[0])) return 'Stories need an image or an MP4 video.';
  return null;
}

/** Image formats are delivered through public storage, so every check that can fail later fails here first. */
export async function requireInstagramImageHosting(contentTypes: string[], host = openPublicImageHost()) {
  if (contentTypes.some(type => type.startsWith('image/')) && !await host.configured()) throw new PublicationRequestError('runtime-unavailable', STORAGE_REQUIRED);
}

/**
 * Pins Instagram media for review. Videos keep their bytes; images become the exact JPEG Meta will download.
 * Carousel images share the first item's frame, because Instagram crops every item to it.
 */
export async function admitInstagramMedia(projectId: string, assetIds: string[], raw: unknown, media: Media, signal: AbortSignal): Promise<PublicationAsset[]> {
  const metadata = instagramMetadataSchema.parse(raw), sources = [];
  for (const id of assetIds) sources.push(await media.describe(projectId, id, signal));
  const problem = allowed(metadata, sources.map(source => source.type === 'video' && source.mimeType === 'video/mp4' ? 'video' : source.type));
  if (problem) throw new PublicationRequestError('invalid-input', problem);
  const frame = metadata.kind === 'reel' ? 'fill' : metadata.frame ?? (metadata.kind === 'story' ? 'fit' : 'fill');
  await requireInstagramImageHosting(sources.map(source => source.mimeType));
  let ratio: number | undefined;
  const assets: PublicationAsset[] = [];
  for (const [index, source] of sources.entries()) {
    if (source.type === 'video') {
      const pinned = await media.pin(projectId, assetIds[index], signal), probe = await media.inspectAsset(projectId, pinned, signal);
      validateInstagramVideo(probe, pinned.sizeBytes, metadata);
      const picture = probe.streams.find(stream => stream.codec_type === 'video');
      ratio ??= picture?.width && picture.height ? feedRatio(picture.width, picture.height) : 1;
      assets.push(pinned); continue;
    }
    assets.push(await media.pinDerived(projectId, assetIds[index], async (input, output) => {
      const size = await probeInstagramImage(input, signal), story = metadata.kind === 'story';
      const target = story ? INSTAGRAM_STORY_RATIO : ratio ?? feedRatio(size.width, size.height);
      ratio ??= target;
      await renderInstagramJpeg(input, output, planInstagramImage(size, target, frame, story ? INSTAGRAM_STORY_MAX_WIDTH : INSTAGRAM_FEED_MAX_WIDTH, !story), signal);
      return 'image/jpeg';
    }, signal));
  }
  return assets;
}
