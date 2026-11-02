import { timelineOutputFrame } from './output-frame';
import { buildOverlayFilters } from './overlay-render.server';
import { buildTransitionFilters } from './transition-render.server';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCaptionFilters, captionFilterRequirement } from './caption-render.server';
export { wrapCaptionForFfmpeg } from './caption-render.server';
import {
  getTimelineClipSource,
  type TimelineClip,
  type TimelineDocument,
  type TimelineTrackKind,
} from './timeline-document';
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

type MediaProbe = {
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
};

type RenderInput = {
  clip: TimelineClip;
  trackKind: TimelineTrackKind;
  inputIndex: number;
  filePath: string;
  source: ReturnType<typeof getTimelineClipSource>;
  probe: MediaProbe;
};

const ffmpegBin = () => process.env.VIRAL_HIT_FFMPEG?.trim() || 'ffmpeg';
const ffprobeBin = () => process.env.VIRAL_HIT_FFPROBE?.trim() || 'ffprobe';

const runProcess = (
  command: string,
  args: string[],
  { captureStdout = false }: { captureStdout?: boolean } = {}
) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      if (captureStdout) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 24_000) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      reject(
        new Error(
          `Unable to start ${command}. Ensure ffmpeg and ffprobe are on PATH or set VIRAL_HIT_FFMPEG and VIRAL_HIT_FFPROBE. ${error.message}`
        )
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          stderr.trim() || `${command} failed with exit code ${code ?? 'unknown'}.`
        )
      );
    });
  });

async function probeMedia(filePath: string): Promise<MediaProbe> {
  const output = await runProcess(
    ffprobeBin(),
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height',
      '-of',
      'json',
      filePath,
    ],
    { captureStdout: true }
  );
  const parsed = JSON.parse(output) as {
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };
  const streams = parsed.streams ?? [];
  const visual = streams.find((stream) => stream.codec_type === 'video');
  return {
    width: typeof visual?.width === 'number' ? visual.width : null,
    height: typeof visual?.height === 'number' ? visual.height : null,
    hasVideo: Boolean(visual),
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  };
}

const time = (value: number) => Math.max(0, value).toFixed(3);

async function resolveRenderInputs({
  projectId,
  document,
}: {
  projectId: string;
  document: TimelineDocument;
}) {
  const inputs: RenderInput[] = [];
  for (const track of document.tracks) {
    if (track.hidden || track.muted || track.kind === 'caption') continue;
    for (const clip of track.clips) {
      if (clip.muted && track.kind !== 'video') continue;
      const source = getTimelineClipSource(clip);
      const asset = await getProjectAssetById({
        projectId,
        assetId: source.assetId,
      });
      if (!asset) {
        throw new Error(`Timeline asset ${source.assetId} is unavailable.`);
      }
      if (asset.bucket !== LOCAL_PROJECT_ASSET_BUCKET || !asset.objectKey) {
        throw new Error('MCP timeline rendering requires project-owned local assets.');
      }
      const filePath = resolveLocalProjectAssetPath({ objectKey: asset.objectKey });
      const probe = await probeMedia(filePath);
      if (clip.sourceType === 'audio' && !probe.hasAudio) {
        throw new Error(`Timeline audio is unreadable: ${source.name}`);
      }
      if (clip.sourceType !== 'audio' && !probe.hasVideo) {
        throw new Error(`Timeline visual is unreadable: ${source.name}`);
      }
      inputs.push({
        clip,
        trackKind: track.kind,
        inputIndex: inputs.length + 1,
        filePath,
        source,
        probe,
      });
    }
  }
  return inputs;
}

async function buildFfmpegArgs({
  document,
  inputs,
  directory,
  outputPath,
}: {
  document: TimelineDocument;
  inputs: RenderInput[];
  directory: string;
  outputPath: string;
}) {
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
    `color=c=black:s=${width}x${height}:r=30:d=${time(document.duration)}`,
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
  filters.push(`[0:v]setpts=PTS-STARTPTS[${visualLabel}]`);
  let visualIndex = 0;
  for (const input of inputs.filter((item) => item.trackKind === 'video')) {
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
    document, width, height, visualLabel, firstInputIndex: inputs.length + 1,
    sources: new Map(inputs.filter((input) => input.trackKind === 'video' && input.clip.sourceType !== 'audio').map((input) => [input.clip.id,
      { filePath: input.filePath, sourceType: input.clip.sourceType === 'image' ? 'image' as const : 'video' as const, inPoint: input.source.inPoint, outPoint: input.source.outPoint }])),
  });
  args.push(...transitions.inputArgs);
  filters.push(...transitions.filters);
  visualLabel = transitions.output;

  let overlayIndex = 0;
  for (const input of inputs.filter((item) => item.trackKind === 'overlay')) {
    if (!input.clip.overlay) continue;
    overlayIndex += 1;
    const overlay = buildOverlayFilters({ clip: input.clip, inputIndex: input.inputIndex,
      inputWidth: input.probe.width ?? 1, inputHeight: input.probe.height ?? 1,
      width, height, visualLabel, index: overlayIndex, sourceInPoint: input.source.inPoint });
    filters.push(...overlay.filters);
    visualLabel = overlay.output;
  }

  const captions = await buildCaptionFilters({ document, directory, width, height, visualLabel });
  filters.push(...captions.filters);
  visualLabel = captions.output;
  filters.push(`[${visualLabel}]format=yuv420p[vout]`);

  const audioLabels: string[] = [];
  let audioIndex = 0;
  for (const input of inputs.filter((item) => item.probe.hasAudio && !item.clip.muted)) {
    audioIndex += 1;
    const label = `audio${audioIndex}`;
    const steps = [
      `atrim=start=${time(input.source.inPoint)}:end=${time(input.source.outPoint)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${Math.max(0, input.clip.volume).toFixed(3)}`,
    ];
    if (input.clip.fadeIn > 0) {
      steps.push(`afade=t=in:st=0:d=${time(input.clip.fadeIn)}`);
    }
    if (input.clip.fadeOut > 0) {
      steps.push(
        `afade=t=out:st=${time(input.clip.duration - input.clip.fadeOut)}:d=${time(input.clip.fadeOut)}`
      );
    }
    steps.push(`adelay=${Math.round(input.clip.startTime * 1000)}:all=1`);
    filters.push(`[${input.inputIndex}:a]${steps.join(',')}[${label}]`);
    audioLabels.push(`[${label}]`);
  }
  if (audioLabels.length > 0) {
    filters.push(
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,` +
        `atrim=duration=${time(document.duration)},apad=whole_dur=${time(document.duration)}[aout]`
    );
  }

  args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
  if (audioLabels.length > 0) {
    args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-an');
  }
  args.push(
    '-t',
    time(document.duration),
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath
  );
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
