import { m as uiMessages } from '@/paraglide/messages.js';
import type { InstagramKind } from '@/core/publishing/instagram-contract';
import type { PublicationVideo } from './use-publications';

export const instagramKinds: InstagramKind[] = ['reel', 'story', 'image', 'carousel'];
export const instagramKindLabel = (kind: InstagramKind) => kind === 'reel' ? uiMessages["ui.publishing.reel"]() : kind === 'story' ? uiMessages["ui.publishing.story"]() : kind === 'image' ? uiMessages["ui.publishing.instagram_post"]() : uiMessages["ui.publishing.carousel"]();
/** Raster images the converter can read; vector files are excluded. */
export const isPublishableImage = (item?: Pick<PublicationVideo, 'mimeType'>) => Boolean(item?.mimeType?.startsWith('image/') && item.mimeType !== 'image/svg+xml');
export const isMp4 = (item?: Pick<PublicationVideo, 'mimeType'>) => item?.mimeType === 'video/mp4';
