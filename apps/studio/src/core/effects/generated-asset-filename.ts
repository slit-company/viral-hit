import type { AssetType } from '@/core/workspace-lib/assets/user-assets';

const DEFAULT_EXTENSION: Record<AssetType, string> = { image: '.png', video: '.mp4', audio: '.wav' };
const OPAQUE_STEM = /^(?:[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|output|result|file|image|video|audio|generated(?:-\w+)?|\d+)$/i;
const MAX_WORDS = 6;

const urlFilename = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
};

const promptStem = (prompt: string | null | undefined) =>
  (prompt ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_WORDS)
    .join('-');

/**
 * Names a saved provider result so people can recognise it in the media bin.
 * Provider URLs usually end in a content hash; the prompt says far more.
 */
export function generatedAssetFilename({ url, type, prompt, index = 0 }: { url: string; type: AssetType; prompt?: string | null; index?: number }) {
  const fromUrl = urlFilename(url);
  const dot = fromUrl.lastIndexOf('.');
  const stem = dot > 0 ? fromUrl.slice(0, dot) : fromUrl;
  const extension = dot > 0 ? fromUrl.slice(dot).toLowerCase() : DEFAULT_EXTENSION[type];
  if (stem && !OPAQUE_STEM.test(stem)) return fromUrl;
  const readable = promptStem(prompt) || `generated-${type}`;
  return `${readable}${index > 0 ? `-${index + 1}` : ''}${extension}`;
}
