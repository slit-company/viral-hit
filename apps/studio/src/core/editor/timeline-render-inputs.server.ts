import { spawn } from 'node:child_process';
import { getTimelineClipSource, type TimelineClip, type TimelineDocument, type TimelineTrackKind } from './timeline-document';
import { LOCAL_PROJECT_ASSET_BUCKET, resolveLocalProjectAssetPath } from '@/core/projects/local-project-assets';
import { getProjectAssetById } from '@/core/workspace-lib/assets/user-assets';

/** Project media resolved for an FFmpeg timeline render, shared by the flattened and layered exports. */
export type MediaProbe = {
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
};

export type RenderInput = {
  clip: TimelineClip;
  trackKind: TimelineTrackKind;
  inputIndex: number;
  filePath: string;
  source: ReturnType<typeof getTimelineClipSource>;
  probe: MediaProbe;
};

export const ffmpegBin = () => process.env.VIRAL_HIT_FFMPEG?.trim() || 'ffmpeg';
export const ffprobeBin = () => process.env.VIRAL_HIT_FFPROBE?.trim() || 'ffprobe';

export const runProcess = (
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

export async function probeMedia(filePath: string): Promise<MediaProbe> {
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

export const time = (value: number) => Math.max(0, value).toFixed(3);

export async function resolveRenderInputs({
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
