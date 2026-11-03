import { timelineOutputFrame } from './output-frame';
import { drawImageOverlay } from './overlay-export';
export { drawImageOverlay } from './overlay-export';
import { drawTimelineCaption } from './caption-canvas';
export { wrapCaptionText } from './caption-canvas';
import {
  getTimelineClipSource,
  type TimelineClip,
  type TimelineDocument,
  type TimelineTrackKind,
} from './timeline-document';
import { diagnoseTimeline } from './timeline-diagnostics';
import { duckingGain, voiceIntervals } from './audio-ducking';
import { createBaseVisualPainter } from './timeline-frame-export';

export type LocalMediaMetadata = {
  duration: number;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
};

export async function inspectLocalMedia(file: File): Promise<LocalMediaMetadata> {
  const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  try {
    const [duration, videoTrack, audioTrack] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);

    return {
      duration,
      width: videoTrack?.displayWidth ?? null,
      height: videoTrack?.displayHeight ?? null,
      hasVideo: Boolean(videoTrack),
      hasAudio: Boolean(audioTrack),
      videoCodec: videoTrack?.codec ?? null,
      audioCodec: audioTrack?.codec ?? null,
    };
  } finally {
    input.dispose();
  }
}

export async function exportTrimmedMp4({
  file,
  start,
  end,
  onProgress,
}: {
  file: File;
  start: number;
  end: number;
  onProgress?: (progress: number) => void;
}) {
  if (!(end > start)) throw new Error('The export range is empty.');

  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
  } = await import('mediabunny');

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });

  try {
    const conversion = await Conversion.init({
      input,
      output,
      trim: { start, end },
      video: {
        codec: 'avc',
        bitrate: QUALITY_HIGH,
        forceTranscode: true,
        keyFrameInterval: 1,
      },
      showWarnings: false,
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks
        .map(({ reason }) => reason.replaceAll('_', ' '))
        .join(', ');
      throw new Error(`This browser cannot export the selected media${reasons ? `: ${reasons}` : '.'}`);
    }

    conversion.onProgress = (progress) => onProgress?.(progress);
    await conversion.execute();

    if (!target.buffer) throw new Error('The encoder produced no MP4 data.');
    onProgress?.(1);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}

type TimelineMediaRecord = {
  clip: TimelineClip;
  trackKind: TimelineTrackKind;
  trackIndex: number;
  source: ReturnType<typeof getTimelineClipSource>;
  input: import('mediabunny').Input | null;
  videoTrack: import('mediabunny').InputVideoTrack | null;
  audioTrack: import('mediabunny').InputAudioTrack | null;
  imageBitmap: ImageBitmap | null;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
};

async function loadTimelineMedia(
  document: TimelineDocument,
  signal?: AbortSignal
) {
  const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
  const records: TimelineMediaRecord[] = [];
  try {
    for (const [trackIndex, track] of document.tracks.entries()) {
      if (track.hidden || track.muted) continue;
      for (const clip of track.clips) {
        throwIfAborted(signal);
        if (clip.sourceType === 'caption' || (track.kind === 'overlay' && clip.muted)) continue;
        const source = getTimelineClipSource(clip);
        const response = await fetch(source.sourceUrl, { signal });
        if (!response.ok) {
          throw new Error(`Timeline source is unavailable: ${source.name}`);
        }
        const blob = await response.blob();
        if (clip.sourceType === 'image') {
          const imageBitmap = await createImageBitmap(blob);
          records.push({
            clip,
            trackKind: track.kind,
            trackIndex,
            source,
            input: null,
            videoTrack: null,
            audioTrack: null,
            imageBitmap,
          });
          continue;
        }
        const input = new Input({
          source: new BlobSource(blob),
          formats: ALL_FORMATS,
        });
        try {
          const [videoTrack, audioTrack] = await Promise.all([
            input.getPrimaryVideoTrack(),
            input.getPrimaryAudioTrack(),
          ]);
          records.push({
            clip,
            trackKind: track.kind,
            trackIndex,
            source,
            input,
            videoTrack,
            audioTrack,
            imageBitmap: null,
          });
        } catch (error) {
          input.dispose();
          throw error;
        }
      }
    }
    return records;
  } catch (error) {
    disposeTimelineMediaRecords(records);
    throw error;
  }
}

function disposeTimelineMediaRecords(records: TimelineMediaRecord[]) {
  for (const record of records) {
    record.input?.dispose();
    record.imageBitmap?.close();
  }
}

function gainAt(clip: TimelineClip, clipOffset: number, voices: readonly (readonly [number, number])[]) {
  if (clip.muted) return 0;
  const fadeIn = clip.fadeIn > 0 ? Math.min(1, clipOffset / clip.fadeIn) : 1;
  const fadeOut =
    clip.fadeOut > 0
      ? Math.min(1, (clip.duration - clipOffset) / clip.fadeOut)
      : 1;
  const duck = clip.ducking ? duckingGain(voices, clip.ducking, clip.startTime + clipOffset) : 1;
  return Math.max(0, Math.min(1, clip.volume * Math.min(fadeIn, fadeOut) * duck));
}

async function mixTimelineAudio(
  records: TimelineMediaRecord[],
  duration: number,
  sampleRate: number,
  signal: AbortSignal | undefined,
  voices: readonly (readonly [number, number])[]
) {
  const { AudioBufferSink } = await import('mediabunny');
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.max(1, Math.ceil(duration * sampleRate)),
    sampleRate,
  });
  let scheduled = false;

  for (const record of records) {
    if (!record.audioTrack || record.clip.muted) continue;
    const sink = new AudioBufferSink(record.audioTrack);
    for await (const wrapped of sink.buffers(
      record.source.inPoint,
      record.source.outPoint
    )) {
      throwIfAborted(signal);
      const segmentStart = Math.max(record.source.inPoint, wrapped.timestamp);
      const segmentEnd = Math.min(
        record.source.outPoint,
        wrapped.timestamp + wrapped.buffer.duration
      );
      const segmentDuration = segmentEnd - segmentStart;
      if (segmentDuration <= 0) continue;

      const timelineStart =
        record.clip.startTime + (segmentStart - record.source.inPoint);
      const timelineEnd = Math.min(duration, timelineStart + segmentDuration);
      if (timelineStart >= duration || timelineEnd <= timelineStart) continue;

      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = wrapped.buffer;
      source.connect(gain);
      gain.connect(context.destination);
      const startOffset = timelineStart - record.clip.startTime;
      const endOffset = timelineEnd - record.clip.startTime;
      gain.gain.setValueAtTime(gainAt(record.clip, startOffset, voices), timelineStart);
      gain.gain.linearRampToValueAtTime(
        gainAt(record.clip, endOffset, voices),
        timelineEnd
      );
      source.start(
        timelineStart,
        Math.max(0, segmentStart - wrapped.timestamp),
        timelineEnd - timelineStart
      );
      scheduled = true;
    }
  }

  return scheduled ? context.startRendering() : null;
}

export async function exportTimelineMp4({
  document,
  onProgress,
  signal,
}: {
  document: TimelineDocument;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}) {
  if (document.duration <= 0) throw new Error('The timeline is empty.');
  const blocking = diagnoseTimeline(document).filter(
    (diagnostic) => diagnostic.severity === 'error'
  );
  if (blocking.length > 0) {
    throw new Error(`Timeline diagnostics failed: ${blocking[0].code}`);
  }

  const {
    AudioBufferSource,
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    QUALITY_HIGH,
    VideoSampleSink,
  } = await import('mediabunny');
  const records = await loadTimelineMedia(document, signal);
  const firstVisual = records.find(
    (record) =>
      record.trackKind === 'video' &&
      (record.videoTrack || record.imageBitmap)
  );
  if (!firstVisual) {
    disposeTimelineMediaRecords(records);
    throw new Error('The timeline does not contain a readable visual track.');
  }

  const visualWidth =
    firstVisual.videoTrack?.displayWidth ?? firstVisual.imageBitmap?.width ?? 1920;
  const visualHeight =
    firstVisual.videoTrack?.displayHeight ?? firstVisual.imageBitmap?.height ?? 1080;
  const { width, height } = timelineOutputFrame(visualWidth, visualHeight);
  const frameRate = 30;
  const frameDuration = 1 / frameRate;
  const sampleRate = 48_000;
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    disposeTimelineMediaRecords(records);
    throw new Error('Canvas2D is unavailable in this browser.');
  }

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: QUALITY_HIGH,
    keyFrameInterval: 1,
  });
  let mixedAudio: AudioBuffer | null;
  try {
    mixedAudio = await mixTimelineAudio(records, document.duration, sampleRate, signal, voiceIntervals(document));
  } catch (error) {
    disposeTimelineMediaRecords(records);
    throw error;
  }
  const audioSource = mixedAudio
    ? new AudioBufferSource({ codec: 'aac', bitrate: 192_000 })
    : null;
  output.addVideoTrack(videoSource, { frameRate });
  if (audioSource) output.addAudioTrack(audioSource);

  try {
    throwIfAborted(signal);
    await output.start();
    const baseVisualRecords = records
      .filter(
        (record) =>
          record.trackKind === 'video' &&
          (record.videoTrack || record.imageBitmap)
      )
      .sort((left, right) => left.clip.startTime - right.clip.startTime);
    const overlayRecords = records
      .filter(
        (record) => record.trackKind === 'overlay' && (record.imageBitmap || record.videoTrack)
      )
      .sort((left, right) => left.trackIndex - right.trackIndex);
    const sinks = new Map(
      [...baseVisualRecords, ...overlayRecords]
        .filter((record) => record.videoTrack)
        .map((record) => [
        record.clip.id,
        new VideoSampleSink(record.videoTrack!),
      ])
    );
    const paintBaseVisual = createBaseVisualPainter({ records: baseVisualRecords, sinks, width, height });
    const frameCount = Math.max(1, Math.ceil(document.duration * frameRate));
    const audioPromise = audioSource?.add(mixedAudio!);

    for (let frame = 0; frame < frameCount; frame += 1) {
      throwIfAborted(signal);
      const timelineTime = Math.min(document.duration, frame * frameDuration);
      context.fillStyle = '#000';
      context.fillRect(0, 0, width, height);
      await paintBaseVisual(context, timelineTime);
      for (const overlay of overlayRecords) {
        if (
          timelineTime < overlay.clip.startTime ||
          timelineTime >= overlay.clip.startTime + overlay.clip.duration
        ) {
          continue;
        }
        const sample = overlay.videoTrack ? await sinks.get(overlay.clip.id)!.getSample(
          Math.min(overlay.source.outPoint - 0.000001, overlay.source.inPoint + timelineTime - overlay.clip.startTime)) : null;
        try {
          const image = overlay.imageBitmap ?? sample?.toCanvasImageSource();
          if (image) drawImageOverlay(context, image, overlay.imageBitmap?.width ?? overlay.videoTrack!.displayWidth,
            overlay.imageBitmap?.height ?? overlay.videoTrack!.displayHeight, overlay.clip, timelineTime, width, height);
        } finally { sample?.close(); }
      }
      drawTimelineCaption(context, document, timelineTime, width, height);
      await videoSource.add(timelineTime, frameDuration, {
        keyFrame: frame % frameRate === 0,
      });
      onProgress?.(((frame + 1) / frameCount) * 0.95);
    }

    await audioPromise;
    throwIfAborted(signal);
    await output.finalize();
    if (!target.buffer) throw new Error('The encoder produced no MP4 data.');
    onProgress?.(1);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (cause) {
    if (output.state === 'started') await output.cancel().catch(() => undefined);
    throw cause;
  } finally {
    disposeTimelineMediaRecords(records);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
