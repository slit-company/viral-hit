import type { PublicationSpec } from './contracts';
import { INSTAGRAM_CAROUSEL_LIMIT, instagramMetadataSchema } from './instagram-contract';

const isImage = (type: string) => type === 'image/jpeg', isVideo = (type: string) => type === 'video/mp4';

/**
 * Retained media shape per format: images were converted to JPEG at admission, videos stay MP4.
 * post marks the multi-container flow; Reels and video Stories keep the single-container protocol.
 */
export function instagramFormat(spec: Pick<PublicationSpec, 'assets' | 'metadata'>) {
  const parsed = instagramMetadataSchema.safeParse(spec.metadata);
  if (!parsed.success) return null;
  const metadata = parsed.data, types = spec.assets.map(asset => asset.contentType), single = types.length === 1;
  const valid = metadata.kind === 'reel' ? single && isVideo(types[0])
    : metadata.kind === 'story' ? single && (isVideo(types[0]) || isImage(types[0]))
    : metadata.kind === 'image' ? single && isImage(types[0])
    : types.length >= 2 && types.length <= INSTAGRAM_CAROUSEL_LIMIT && types.every(type => isImage(type) || isVideo(type))
      && (metadata.altTexts?.length ?? 0) <= types.length && (metadata.altTexts ?? []).every((text, index) => !text || isImage(types[index]));
  if (!valid) return null;
  return { metadata, post: metadata.kind === 'image' || metadata.kind === 'carousel' || (metadata.kind === 'story' && isImage(types[0])) };
}
