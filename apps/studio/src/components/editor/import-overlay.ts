import { inspectLocalMedia } from '@/core/editor/media-export';
import { uploadLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';

export async function importOverlay(projectId: string, file: File, timelineDuration: number) {
  const video = file.type.startsWith('video/');
  const metadata = video ? await inspectLocalMedia(file) : null;
  if (video && (!metadata?.hasVideo || metadata.duration <= 0)) throw Error('Choose a readable video with a positive duration.');
  const bitmap = video ? null : await createImageBitmap(file);
  try {
    const asset = await uploadLocalProjectAsset({ projectId, file,
      width: bitmap?.width ?? metadata?.width ?? undefined, height: bitmap?.height ?? metadata?.height ?? undefined,
      durationMs: metadata ? metadata.duration * 1000 : undefined });
    const duration = Math.min(3, timelineDuration, metadata?.duration ?? Infinity);
    return { type: 'add_overlay' as const, assetId: asset.id, sourceUrl: asset.publicUrl, name: file.name,
      sourceType: video ? 'video' as const : 'image' as const, sourceDuration: metadata?.duration ?? duration,
      startTime: Math.max(0, timelineDuration - duration), duration, x: .5, y: .25, width: .7, opacity: 1, fadeIn: Math.min(.6, duration) };
  } finally { bitmap?.close(); }
}
