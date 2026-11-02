import { timelineOutputFrame } from './output-frame';
import { buildOverlayFilters } from './overlay-render.server';
import { buildTransitionFilters } from './transition-render.server';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCaptionFilters, captionFilterRequirement } from './caption-render.server';
import { buildAudioMix } from './audio-mix.server';
export { wrapCaptionForFfmpeg } from './caption-render.server';
import type { TimelineDocument } from './timeline-document';
import { ffmpegBin, resolveRenderInputs, runProcess, time, type RenderInput } from './timeline-render-inputs.server';
import { diagnoseTimeline } from './timeline-diagnostics';
import {
  LOCAL_PROJECT_ASSET_BUCKET,
  LOCAL_PROJECT_ASSET_PROVIDER,
  persistLocalProjectAsset,
  removePersistedLocalProjectAsset,
  resolveLocalProjectAssetPath,
} from '@/core/projects/local-project-assets';
import {
  deleteUserAssetById,
  getProjectAssetById,
  linkProjectAsset,
  recordUserAsset,
} from '@/core/workspace-lib/assets/user-assets';

/** composite is the finished video; the other layers render one part each, overlays and captions on transparency. */
export type TimelineLayer = 'composite' | 'picture' | 'overlays' | 'captions';

export async function buildFfmpegArgs({
  document,
  inputs,
  directory,
  outputPath,
  layer = 'composite',
}: {
  document: TimelineDocument;
  inputs: RenderInput[];
  directory: string;
  outputPath: string;
  layer?: TimelineLayer;
}) {
  const transparent = layer === 'overlays' || layer === 'captions';
  const includes = (part: Exclude<TimelineLayer, 'composite'>) => layer === 'composite' || layer === part;
  const firstVisual = inputs.find(
    (input) => input.trackKind === 'video' && input.probe.hasVideo
  );
  if (!firstVisual) throw new Error('The timeline has no readable visual clip.');
  const { width, height } = timelineOutputFrame(firstVisual.probe.width ?? 0, firstVisual.probe.height ?? 0);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    // The lavfi input negotiates its own pixel format, so a transparent canvas must ask for RGBA there.
    `color=c=black${transparent ? '@0.0' : ''}:s=${width}x${height}:r=30:d=${time(document.duration)}${transparent ? ',format=rgba' : ''}`,
  ];
  for (const input of inputs) {
    if (input.clip.sourceType === 'image') {
      args.push(
        '-loop',
        '1',
        '-framerate',
        '30',
        '-t',
        time(input.clip.duration),
        '-i',
        input.filePath
      );
    } else {
      args.push('-i', input.filePath);
    }
  }

  const filters: string[] = [];
  let visualLabel = 'canvas0';
  filters.push(`[0:v]${transparent ? 'format=rgba,' : ''}setpts=PTS-STARTPTS[${visualLabel}]`);
  let visualIndex = 0;
  for (const input of inputs.filter((item) => item.trackKind === 'video' && includes('picture'))) {
    visualIndex += 1;
    const sourceLabel = `visual${visualIndex}`;
    const nextLabel = `canvas${visualIndex}`;
    filters.push(
      `[${input.inputIndex}:v]trim=start=${time(input.source.inPoint)}:end=${time(input.source.outPoint)},` +
        `setpts=PTS-STARTPTS+${time(input.clip.startTime)}/TB,` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black[${sourceLabel}]`
    );
    filters.push(
      `[${visualLabel}][${sourceLabel}]overlay=0:0:eof_action=pass:` +
        `enable='between(t,${time(input.clip.startTime)},${time(input.clip.startTime + input.clip.duration)})'[${nextLabel}]`
    );
    visualLabel = nextLabel;
  }

  const transitions = buildTransitionFilters({
    document: includes('picture') ? document : { ...document, tracks: [] }, width, height, visualLabel, firstInputIndex: inputs.length + 1,
    sources: new Map(inputs.filter((input) => input.trackKind === 'video' && input.clip.sourceType !== 'audio').map((input) => [input.clip.id,
      { filePath: input.filePath, sourceType: input.clip.sourceType === 'image' ? 'image' as const : 'video' as const, inPoint: input.source.inPoint, outPoint: input.source.outPoint }])),
  });
  args.push(...transitions.inputArgs);
  filters.push(...transitions.filters);
  visualLabel = transitions.output;

  let overlayIndex = 0;
  for (const input of inputs.filter((item) => item.trackKind === 'overlay' && includes('overlays'))) {
    if (!input.clip.overlay) continue;
    overlayIndex += 1;
    const overlay = buildOverlayFilters({ clip: input.clip, inputIndex: input.inputIndex,
      inputWidth: input.probe.width ?? 1, inputHeight: input.probe.height ?? 1,
      width, height, visualLabel, index: overlayIndex, sourceInPoint: input.source.inPoint });
    filters.push(...overlay.filters);
    visualLabel = overlay.output;
  }

  const captions = includes('captions') ? await buildCaptionFilters({ document, directory, width, height, visualLabel, transparent }) : { filters: [], output: visualLabel };
  filters.push(...captions.filters);
  visualLabel = captions.output;
  filters.push(`[${visualLabel}]format=${transparent ? 'argb' : 'yuv420p'}[vout]`);

  const audio = layer === 'composite' ? buildAudioMix({ inputs, document }) : null;
  if (audio) filters.push(...audio.filters);

  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (audio) {
    args.push('-map', `[${audio.label}]`, '-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-an');
  }
  // Transparent layers use QuickTime Animation (lossless RGBA), which editing apps import with alpha.
  const codec = transparent ? ['-c:v', 'qtrle', '-pix_fmt', 'argb'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  args.push('-t', time(document.duration), '-r', '30', ...codec, outputPath);
  return { args, width, height };
}

export async function renderProjectTimelineToAsset({
  projectId,
  document,
  timelineRevision,
}: {
  projectId: string;
  document: TimelineDocument;
  timelineRevision: number;
}) {
  const blocking = diagnoseTimeline(document).find(
    (diagnostic) => diagnostic.severity === 'error'
  );
  if (blocking) {
    throw new Error(`Timeline diagnostics failed: ${blocking.code}`);
  }
  const inputs = await resolveRenderInputs({ projectId, document });
  const captionFilter = captionFilterRequirement(document);
  if (captionFilter) {
    const availableFilters = await runProcess(ffmpegBin(), ['-hide_banner', '-filters'], { captureStdout: true });
    if (!new RegExp(`\\b${captionFilter}\\s`).test(availableFilters)) throw new Error(`This FFmpeg build cannot render captions: ${captionFilter} is missing. Install a full FFmpeg build with libfreetype, libharfbuzz and libass and set VIRAL_HIT_FFMPEG to its executable, then retry. Your timeline is preserved.`);
  }
  const directory = await mkdtemp(join(tmpdir(), 'viral-hit-render-'));
  const outputPath = join(directory, 'timeline.mp4');
  try {
    const plan = await buildFfmpegArgs({
      document,
      inputs,
      directory,
      outputPath,
    });
    await runProcess(ffmpegBin(), plan.args);
    const bytes = new Uint8Array(await readFile(outputPath));
    const persisted = await persistLocalProjectAsset({
      projectId,
      filename: `${document.name}-timeline.mp4`,
      mimeType: 'video/mp4',
      bytes,
    });
    try {
      const clipCount = document.tracks.reduce(
        (count, track) => count + track.clips.length,
        0
      );
      const id = await recordUserAsset({
        id: persisted.assetId,
        type: 'video',
        source: 'derived',
        bucket: LOCAL_PROJECT_ASSET_BUCKET,
        objectKey: persisted.objectKey,
        publicUrl: persisted.publicUrl,
        mimeType: 'video/mp4',
        sizeBytes: persisted.sizeBytes,
        sha256: persisted.sha256,
        filename: persisted.filename,
        storageProvider: LOCAL_PROJECT_ASSET_PROVIDER,
        assetClass: 'derived',
        originProjectId: projectId,
        width: plan.width,
        height: plan.height,
        durationMs: Math.round(document.duration * 1000),
        metadata: {
          operation: 'timeline_render',
          timelineId: document.id,
          timelineRevision,
          clipCount,
          renderer: 'mcp-ffmpeg',
        },
      });
      await linkProjectAsset({
        projectId,
        assetId: id,
        role: 'generated',
        assetRole: 'timeline_render',
        metadata: { timelineId: document.id, timelineRevision },
      });
      return {
        id,
        type: 'video' as const,
        publicUrl: persisted.publicUrl,
        filename: persisted.filename,
        mimeType: 'video/mp4' as const,
        sizeBytes: persisted.sizeBytes,
        width: plan.width,
        height: plan.height,
        durationMs: Math.round(document.duration * 1000),
        localPath: persisted.filePath,
      };
    } catch (error) {
      await deleteUserAssetById(persisted.assetId).catch(() => undefined);
      await removePersistedLocalProjectAsset(persisted.filePath);
      throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function removeRenderedProjectTimelineAsset({
  projectId,
  assetId,
}: {
  projectId: string;
  assetId: string;
}) {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset?.objectKey || asset.bucket !== LOCAL_PROJECT_ASSET_BUCKET) return;
  const filePath = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
  try {
    await deleteUserAssetById(assetId);
  } finally {
    await removePersistedLocalProjectAsset(filePath);
  }
}
