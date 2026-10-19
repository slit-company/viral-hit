import { useTimelineFrame } from './use-timeline-frame';
import { EditorInspectorPanel, useInspectorPanel } from './editor-inspector-panel';
import { OverlayInspector } from './overlay-inspector';
import { canEditOverlayPose, overlayTransformAt } from '@/core/editor/overlay-motion';
import { TimelineDraftRecovery } from './timeline-draft-recovery';
import { Action } from '@/components/base/action';
import {
  Download,
  FileVideo2,
  Grid2X2,
  ImageIcon,
  Layers2,
  List,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Search,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
  Undo2,
  Redo2,
  Volume2,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useTranslations } from '@/core/workspace-lib/shims/next-intl';
import { uploadLocalProjectAsset } from '@/core/workspace-lib/app/local-project-asset-client';
import { TimelineClipBlock } from './timeline-clip-block';
import { useTimelinePersistence } from './use-timeline-persistence';
import { saveTimelineThroughCommand } from '@/core/editor/timeline-persistence';
export { shouldPersistTimelineDocument, timelineDocumentsEqualForPersistence } from '@/core/editor/timeline-persistence';
import { createCommandId } from '@/core/commands/contracts';
import {
  applyEditorOperations,
  type EditorOperation,
} from '@/core/commands/editor-commands';
import {
  CAPTION_STYLE_PRESETS,
  findCaptionAtTime,
  getCaptionStyleDefinition,
  getResolvedCaptionStyle,
  MAX_SRT_FILE_BYTES,
} from '@/core/editor/captions';
import {
  createTimelineDocument,
  findOverlayClipsAtTime,
  findTimelineClip,
  getTimelineClipSource,
  isOverlayClip,
  overlayOpacityAt,
  type TimelineClip,
  type TimelineDocument,
} from '@/core/editor/timeline-document';
import { DEFAULT_IMAGE_CLIP_DURATION } from '@/core/editor/timeline-client';
import {
  downloadBlob,
  exportTimelineMp4,
  exportTrimmedMp4,
  inspectLocalMedia,
  type LocalMediaMetadata,
} from '@/core/editor/media-export';
import { diagnoseTimeline } from '@/core/editor/timeline-diagnostics';
import { mergeTimelineDocuments } from '@/core/editor/timeline-merge';
import {
  buildTimelineDragPreview,
  timelineTimeFromClientX,
  type TimelineClipInteractionPreview,
  type TimelineDragMode,
} from '@/core/editor/timeline-interaction';
import { redoTimelineSelection } from '@/core/editor/cloud-api-redo';
import { fetchRecentAssets } from '@/core/workspace-lib/app/workspace-client-api';
import { apiJsonGet, apiJsonPost } from '@/lib/api-client';
import { seekStaticVideoPreview } from '@/core/media/video-preview';
import {
  WORKSPACE_MUTATION_HEADER,
  WORKSPACE_MUTATION_HEADER_VALUE,
} from '@/lib/trusted-local-request';

const MIN_CLIP_DURATION = 0.04;
export const PROJECT_TIMELINE_EXTERNAL_POLL_INTERVAL_MS = 2_000;

type TimelineDragSession = {
  clip: TimelineClip;
  mode: TimelineDragMode;
  originClientX: number;
  timelineWidth: number;
  timelineDuration: number;
  preview: TimelineClipInteractionPreview;
};

type OverlayDragSession = {
  clipId: string;
  pointerId: number;
  originClientX: number;
  originClientY: number;
  originX: number;
  originY: number;
  frameWidth: number;
  frameHeight: number;
  x: number;
  y: number;
};

export function moveOverlayInPreview({
  originX,
  originY,
  deltaX,
  deltaY,
  frameWidth,
  frameHeight,
}: {
  originX: number;
  originY: number;
  deltaX: number;
  deltaY: number;
  frameWidth: number;
  frameHeight: number;
}) {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    x: clamp(originX + deltaX / Math.max(1, frameWidth)),
    y: clamp(originY + deltaY / Math.max(1, frameHeight)),
  };
}

export function findVisualClipAtTimelineTime(
  document: TimelineDocument,
  timelineTime: number
) {
  const visualClips = document.tracks
    .filter((track) => track.kind === 'video' && !track.hidden && !track.muted)
    .flatMap((track) => track.clips)
    .filter((clip) => clip.sourceType === 'image' || clip.sourceType === 'video')
    .sort((left, right) => left.startTime - right.startTime);
  const safeTime = Math.max(0, Math.min(timelineTime, document.duration));

  return (
    visualClips.find(
      (clip) =>
        safeTime >= clip.startTime &&
        safeTime < clip.startTime + clip.duration
    ) ??
    [...visualClips]
      .reverse()
      .find(
        (clip) =>
          safeTime === document.duration &&
          Math.abs(clip.startTime + clip.duration - safeTime) < 0.001
      )
  );
}

const formatTime = (seconds: number) => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
};

const safeFilename = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'viral-hit-clip';

export function VideoEditorWorkspace({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const t = useTranslations('AppShell.editor');
  const loadFailedMessage = t('errors.loadFailed');
  const saveFailedMessage = t('errors.saveFailed');
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);
  const sourceFileRef = useRef<File | null>(null);
  const audioElementsRef = useRef(new Map<string, HTMLAudioElement>());
  const imagePlaybackFrameRef = useRef<number | null>(null);
  const timelineDragRef = useRef<TimelineDragSession | null>(null);
  const overlayDragRef = useRef<OverlayDragSession | null>(null);
  const timelineLoadedRef = useRef(false);
  const timelineVersionRef = useRef<number | null>(null);
  const lastSavedDocumentRef = useRef<TimelineDocument | null>(null);
  const exportControllerRef = useRef<AbortController | null>(null);
  const documentRef = useRef<TimelineDocument | null>(null);
  const pastDocumentsRef = useRef<TimelineDocument[]>([]);
  const futureDocumentsRef = useRef<TimelineDocument[]>([]);
  const [document, setDocument] = useState(() =>
    createTimelineDocument({ projectId, name: projectName })
  );
  const [isTimelineHydrated, setIsTimelineHydrated] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<LocalMediaMetadata | null>(null);
  const previewDimensions = useTimelineFrame(document);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [timelineCursorTime, setTimelineCursorTime] = useState(0);
  const [timelineDragPreview, setTimelineDragPreview] =
    useState<TimelineClipInteractionPreview | null>(null);
  const [overlayDragPreview, setOverlayDragPreview] = useState<{
    clipId: string;
    x: number;
    y: number;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [exactControlsOpen, setExactControlsOpen] = useState(false);
  const { open: isInspectorOpen, setOpen: setInspectorOpen, narrow: isInspectorNarrow } = useInspectorPanel();
  const [isInspecting, setIsInspecting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [redoOpen, setRedoOpen] = useState(false);
  const [redoPrompt, setRedoPrompt] = useState('');
  const [redoStatus, setRedoStatus] = useState('');
  const [isRedoing, setIsRedoing] = useState(false);
  const [mediaSearch, setMediaSearch] = useState('');
  const [mediaView, setMediaView] = useState<'grid' | 'list'>('grid');
  const [historyRevision, setHistoryRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const clips = useMemo(
    () => document.tracks.flatMap((track) => track.clips),
    [document.tracks]
  );
  const selectedClip = selectedClipId
    ? findTimelineClip(document, selectedClipId)
    : undefined;
  const selectedIsOverlay = selectedClip
    ? isOverlayClip(document, selectedClip.id)
    : false;
  const displayedSelectedClip =
    selectedClip && timelineDragPreview?.id === selectedClip.id
      ? { ...selectedClip, ...timelineDragPreview }
      : selectedClip;
  const selectedSource = selectedClip
    ? getTimelineClipSource(selectedClip)
    : null;
  const selectedCaptionStyle =
    selectedClip?.sourceType === 'caption'
      ? getResolvedCaptionStyle(document, selectedClip)
      : null;
  const timelineCurrentTime = Math.max(
    0,
    Math.min(timelineCursorTime, document.duration)
  );
  const timelineDisplayDuration = Math.max(
    document.duration,
    timelineDragPreview
      ? timelineDragPreview.startTime + timelineDragPreview.duration
      : 0,
    0.001
  );
  const primaryVisualClip = document.tracks
    .filter((track) => track.kind === 'video' && !track.hidden && !track.muted).flatMap(track => track.clips)
    .find(
      (clip) => clip.sourceType === 'image' || clip.sourceType === 'video'
    );
  const activeCaption = findCaptionAtTime(document, timelineCurrentTime);
  const activeCaptionStyle = getResolvedCaptionStyle(document, activeCaption);
  const activeOverlays = findOverlayClipsAtTime(document, timelineCurrentTime);
  const activeVisualClip = findVisualClipAtTimelineTime(
    document,
    timelineCurrentTime
  );
  const previewClip = activeVisualClip ?? primaryVisualClip;
  const previewSource = previewClip ? getTimelineClipSource(previewClip) : null;
  const previewOffset = previewClip
    ? Math.max(
        0,
        Math.min(
          previewClip.duration,
          timelineCurrentTime - previewClip.startTime
        )
      )
    : 0;
  const canSplitAtPlayhead = Boolean(
    activeVisualClip &&
      activeVisualClip.sourceType === 'video' &&
      !activeVisualClip.activeTakeId &&
      timelineCurrentTime >
        activeVisualClip.startTime + MIN_CLIP_DURATION &&
      timelineCurrentTime <
        activeVisualClip.startTime +
          activeVisualClip.duration -
          MIN_CLIP_DURATION
  );
  const projectMedia = useMemo(() => {
    const seenAssetIds = new Set<string>();
    return clips
      .filter((clip) => {
        if (clip.sourceType === 'caption') return false;
        if (seenAssetIds.has(clip.assetId)) return false;
        seenAssetIds.add(clip.assetId);
        return clip.name.toLowerCase().includes(mediaSearch.trim().toLowerCase());
      })
      .sort((left, right) => left.startTime - right.startTime);
  }, [clips, mediaSearch]);
  const canUndo = historyRevision >= 0 && pastDocumentsRef.current.length > 0;
  const canRedo = historyRevision >= 0 && futureDocumentsRef.current.length > 0;
  documentRef.current = document;

  const commitDocument = (
    updater: typeof document | ((current: typeof document) => typeof document)
  ) => {
    setDocument((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (next === current || JSON.stringify(next) === JSON.stringify(current)) {
        return current;
      }
      pastDocumentsRef.current.push(current);
      if (pastDocumentsRef.current.length > 100) pastDocumentsRef.current.shift();
      futureDocumentsRef.current = [];
      setHistoryRevision((value) => value + 1);
      return next;
    });
  };

  const startOverlayDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    overlay: TimelineClip
  ) => {
    if (!overlay.overlay || event.button !== 0 || !canEditOverlayPose(overlay, timelineCurrentTime)) return;
    const pose = overlayTransformAt(overlay, timelineCurrentTime)!;
    const frame = previewFrameRef.current?.getBoundingClientRect();
    if (!frame) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedClipId(overlay.id);
    overlayDragRef.current = {
      clipId: overlay.id,
      pointerId: event.pointerId,
      originClientX: event.clientX,
      originClientY: event.clientY,
      originX: pose.x,
      originY: pose.y,
      frameWidth: frame.width,
      frameHeight: frame.height,
      x: pose.x,
      y: pose.y,
    };
    setOverlayDragPreview({
      clipId: overlay.id,
      x: pose.x,
      y: pose.y,
    });
  };

  const moveOverlayDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = overlayDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const position = moveOverlayInPreview({
      originX: session.originX,
      originY: session.originY,
      deltaX: event.clientX - session.originClientX,
      deltaY: event.clientY - session.originClientY,
      frameWidth: session.frameWidth,
      frameHeight: session.frameHeight,
    });
    session.x = position.x;
    session.y = position.y;
    setOverlayDragPreview({ clipId: session.clipId, ...position });
  };

  const finishOverlayDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = overlayDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    overlayDragRef.current = null;
    setOverlayDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    commitDocument((current) =>
      applyEditorOperations(current, [
        {
          type: 'update_overlay',
          clipId: session.clipId,
          atTime: timelineCurrentTime,
          patch: { x: session.x, y: session.y },
        },
      ]).document
    );
  };

  const nudgeOverlay = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    overlay: TimelineClip
  ) => {
    if (!overlay.overlay || !canEditOverlayPose(overlay, timelineCurrentTime)) return;
    const pose = overlayTransformAt(overlay, timelineCurrentTime)!;
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta =
      event.key === 'ArrowLeft'
        ? { x: -step, y: 0 }
        : event.key === 'ArrowRight'
          ? { x: step, y: 0 }
          : event.key === 'ArrowUp'
            ? { x: 0, y: -step }
            : event.key === 'ArrowDown'
              ? { x: 0, y: step }
              : null;
    if (!delta) return;
    event.preventDefault();
    commitDocument((current) =>
      applyEditorOperations(current, [
        {
          type: 'update_overlay',
          clipId: overlay.id,
          atTime: timelineCurrentTime,
          patch: {
            x: pose.x + delta.x,
            y: pose.y + delta.y,
          },
        },
      ]).document
    );
  };

  const resetDocument = (next: typeof document) => {
    pastDocumentsRef.current = [];
    futureDocumentsRef.current = [];
    setHistoryRevision((value) => value + 1);
    setDocument(next);
  };

  const undoTimeline = () => {
    const previous = pastDocumentsRef.current.pop();
    if (!previous) return;
    futureDocumentsRef.current.push(document);
    setDocument(previous);
    setHistoryRevision((value) => value + 1);
  };

  const redoTimeline = () => {
    const next = futureDocumentsRef.current.pop();
    if (!next) return;
    pastDocumentsRef.current.push(document);
    setDocument(next);
    setHistoryRevision((value) => value + 1);
  };

  useEffect(() => {
    let active = true;
    timelineLoadedRef.current = false;
    setIsTimelineHydrated(false);
    void apiJsonGet<{
      timeline: { document: typeof document; version: number } | null;
    }>(`/api/app/projects/${encodeURIComponent(projectId)}/timeline`)
      .then((payload) => {
        if (!active) return;
        if (!payload.timeline) {
          const emptyDocument = createTimelineDocument({
            projectId,
            name: projectName,
          });
          // An untouched empty editor is a clean baseline, not a pending full-document save.
          // Otherwise its delayed bootstrap save can erase a first clip added by MCP/Runs.
          timelineVersionRef.current = 0;
          lastSavedDocumentRef.current = emptyDocument;
          documentRef.current = emptyDocument;
          resetDocument(emptyDocument);
          setSelectedClipId(null);
          setSourceUrl(null);
          setMetadata(null);
          setCurrentTime(0);
          setTimelineCursorTime(0);
          timelineLoadedRef.current = true;
          setIsTimelineHydrated(true);
          return;
        }
        timelineVersionRef.current = payload.timeline.version;
        const nextDocument = payload.timeline.document;
        lastSavedDocumentRef.current = nextDocument;
        documentRef.current = nextDocument;
        const visualClips = nextDocument.tracks
          .filter((track) => track.kind === 'video')
          .flatMap((track) => track.clips);
        const requestedTimelineTime = Number(
          new URLSearchParams(window.location.search).get('t')
        );
        const requestedVisual = Number.isFinite(requestedTimelineTime)
          ? visualClips.find(
              (clip) =>
                requestedTimelineTime >= clip.startTime &&
                requestedTimelineTime < clip.startTime + clip.duration
            )
          : undefined;
        const firstVisual = requestedVisual ?? visualClips[0];
        resetDocument(nextDocument);
        setSelectedClipId(firstVisual?.id ?? null);
        const firstSource = firstVisual ? getTimelineClipSource(firstVisual) : null;
        const initialTimelineTime = firstVisual
          ? Number.isFinite(requestedTimelineTime)
            ? Math.max(
                firstVisual.startTime,
                Math.min(
                  firstVisual.startTime + firstVisual.duration,
                  requestedTimelineTime
                )
              )
            : firstVisual.startTime
          : 0;
        setSourceUrl(firstSource?.sourceUrl ?? null);
        setTimelineCursorTime(initialTimelineTime);
        setCurrentTime(
          firstVisual &&
            firstVisual.sourceType === 'video' &&
            firstSource &&
            Number.isFinite(requestedTimelineTime)
            ? firstSource.inPoint +
                Math.max(
                  0,
                  Math.min(
                    firstVisual.duration,
                    requestedTimelineTime - firstVisual.startTime
                  )
                )
            : (firstSource?.inPoint ?? 0)
        );
        setMetadata(
          firstVisual?.sourceType === 'video'
            ? {
                duration: firstVisual.sourceDuration,
                width: null,
                height: null,
                hasVideo: true,
                hasAudio: false,
                videoCodec: null,
                audioCodec: null,
              }
            : null
        );
        timelineLoadedRef.current = true;
        setIsTimelineHydrated(true);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : loadFailedMessage);
        }
      });
    return () => {
      active = false;
    };
  }, [loadFailedMessage, projectId, projectName]);

  const persistence = useTimelinePersistence({
    projectId, document, hydrated: isTimelineHydrated,
    documentRef, versionRef: timelineVersionRef, savedRef: lastSavedDocumentRef,
    onDocument: setDocument, onStatus: setSaveStatus, onError: setError,
    onRemote: (remoteDocument, restored = false) => {
      resetDocument(remoteDocument);
      if (restored && lastSavedDocumentRef.current) pastDocumentsRef.current.push(lastSavedDocumentRef.current);
        const remoteVisualClips = remoteDocument.tracks
          .filter((track) => track.kind === 'video')
          .flatMap((track) => track.clips);
        const remoteClips = remoteDocument.tracks.flatMap(
          (track) => track.clips
        );
        const nextSelectedClip =
          (selectedClipId
            ? remoteClips.find((clip) => clip.id === selectedClipId)
            : undefined) ?? remoteVisualClips[0];
        const nextPreviewClip =
          nextSelectedClip &&
          remoteVisualClips.some((clip) => clip.id === nextSelectedClip.id)
            ? nextSelectedClip
            : findVisualClipAtTimelineTime(
                remoteDocument,
                nextSelectedClip?.startTime ?? timelineCurrentTime
              ) ?? remoteVisualClips[0];
        const nextSource = nextPreviewClip
          ? getTimelineClipSource(nextPreviewClip)
          : null;
        setSelectedClipId(nextSelectedClip?.id ?? null);
        setSourceUrl(nextSource?.sourceUrl ?? null);
        setTimelineCursorTime((time) =>
          Math.max(0, Math.min(time, remoteDocument.duration))
        );
        setCurrentTime((time) =>
          nextPreviewClip
            ? Math.max(
                nextSource?.inPoint ?? 0,
                Math.min(time, nextSource?.outPoint ?? nextPreviewClip.duration)
              )
            : 0
        );
        setMetadata(
          nextPreviewClip?.sourceType === 'video'
            ? {
                duration: nextPreviewClip.sourceDuration,
                width: null,
                height: null,
                hasVideo: true,
                hasAudio: false,
                videoCodec: null,
                audioCodec: null,
              }
            : null
        );

    },
  });

  useEffect(
    () => () => {
      if (sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
    },
    [sourceUrl]
  );

  useEffect(
    () => () => {
      if (imagePlaybackFrameRef.current !== null) {
        cancelAnimationFrame(imagePlaybackFrameRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!previewClip || !previewSource) {
      setSourceUrl(null);
      return;
    }
    const nextSource = previewSource;
    if (sourceUrl !== nextSource.sourceUrl) {
      sourceFileRef.current = null;
      setSourceUrl(nextSource.sourceUrl);
      setCurrentTime(
        previewClip.sourceType === 'video'
          ? nextSource.inPoint + previewOffset
          : previewOffset
      );
    }
  }, [
    previewClip?.activeTakeId,
    previewClip?.id,
    previewClip?.sourceUrl,
    previewOffset,
    previewSource,
    sourceUrl,
  ]);

  const stopImagePlayback = () => {
    if (imagePlaybackFrameRef.current !== null) {
      cancelAnimationFrame(imagePlaybackFrameRef.current);
      imagePlaybackFrameRef.current = null;
    }
    setIsPlaying(false);
  };

  const seek = (time: number, timelineTime?: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = time;
    setCurrentTime(time);
    setTimelineCursorTime(
      timelineTime ??
        (previewClip && previewSource
          ? previewClip.startTime + (time - previewSource.inPoint)
          : time)
    );
  };

  const syncAudioTracks = (timelineTime: number, shouldPlay: boolean) => {
    for (const clip of clips.filter((item) => item.sourceType === 'audio')) {
      const audio = audioElementsRef.current.get(clip.id);
      if (!audio) continue;
      const offset = timelineTime - clip.startTime;
      const active = offset >= 0 && offset < clip.duration && !clip.muted;
      if (!active) {
        audio.pause();
        continue;
      }
      const target = getTimelineClipSource(clip).inPoint + offset;
      if (Math.abs(audio.currentTime - target) > 0.12) audio.currentTime = target;
      const fadeInGain = clip.fadeIn > 0 ? Math.min(1, offset / clip.fadeIn) : 1;
      const fadeOutGain =
        clip.fadeOut > 0
          ? Math.min(1, (clip.duration - offset) / clip.fadeOut)
          : 1;
      audio.volume = Math.max(
        0,
        Math.min(1, clip.volume * Math.min(fadeInGain, fadeOutGain))
      );
      if (shouldPlay && audio.paused) void audio.play().catch(() => undefined);
    }
  };

  const selectClip = (clip: TimelineClip, timelineTime = clip.startTime) => {
    stopImagePlayback();
    setSelectedClipId(clip.id);
    const offset = Math.max(
      0,
      Math.min(clip.duration, timelineTime - clip.startTime)
    );
    setTimelineCursorTime(clip.startTime + offset);
    if (isOverlayClip(document, clip.id)) {
      seekTimeline(clip.startTime + offset);
      return;
    }
    if (clip.sourceType !== 'audio') {
      const source = getTimelineClipSource(clip);
      setSourceUrl(source.sourceUrl);
      sourceFileRef.current = null;
      if (clip.sourceType === 'video') {
        const sourceTime = source.inPoint + offset;
        if (videoRef.current) videoRef.current.currentTime = sourceTime;
        setCurrentTime(sourceTime);
      } else {
        videoRef.current?.pause();
        setCurrentTime(offset);
        setMetadata(null);
      }
    } else {
      videoRef.current?.pause();
      const visualAtSelection = findVisualClipAtTimelineTime(
        document,
        clip.startTime + offset
      );
      if (visualAtSelection) {
        const visualSource = getTimelineClipSource(visualAtSelection);
        const visualOffset = Math.max(
          0,
          Math.min(
            visualAtSelection.duration,
            clip.startTime + offset - visualAtSelection.startTime
          )
        );
        setSourceUrl(visualSource.sourceUrl);
        if (visualAtSelection.sourceType === 'video') {
          const visualSourceTime = visualSource.inPoint + visualOffset;
          if (videoRef.current) videoRef.current.currentTime = visualSourceTime;
          setCurrentTime(visualSourceTime);
        } else {
          setCurrentTime(visualOffset);
        }
      }
    }
  };

  const seekTimeline = (requestedTime: number) => {
    const timelineTime = Math.max(
      0,
      Math.min(document.duration, requestedTime)
    );
    const activeClip = findVisualClipAtTimelineTime(document, timelineTime);

    if (!activeClip) {
      videoRef.current?.pause();
      stopImagePlayback();
      setTimelineCursorTime(timelineTime);
      return;
    }
    const offset = Math.max(
      0,
      Math.min(activeClip.duration, timelineTime - activeClip.startTime)
    );
    setTimelineCursorTime(activeClip.startTime + offset);
    if (activeClip.sourceType === 'video') {
      seek(activeClip.inPoint + offset, activeClip.startTime + offset);
    } else {
      setCurrentTime(offset);
    }
  };

  const loadFile = async (file: File) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      setError(t('errors.visualOnly'));
      return;
    }

    setError(null);
    setIsInspecting(true);
    try {
      const nextMetadata = isVideo ? await inspectLocalMedia(file) : null;
      if (isVideo && (!nextMetadata?.hasVideo || nextMetadata.duration <= 0)) {
        throw new Error(t('errors.noVideoTrack'));
      }
      const imageBitmap = isImage ? await createImageBitmap(file) : null;

      const persistedAsset = await uploadLocalProjectAsset({
        projectId,
        file,
        width: imageBitmap?.width ?? nextMetadata?.width ?? undefined,
        height: imageBitmap?.height ?? nextMetadata?.height ?? undefined,
        durationMs: nextMetadata ? nextMetadata.duration * 1000 : undefined,
      });
      imageBitmap?.close();
      const nextDocument = applyEditorOperations(document, [
        {
          type: 'add_clip',
          assetId: persistedAsset.id,
          sourceUrl: persistedAsset.publicUrl,
          name: file.name,
          sourceType: isImage ? 'image' : 'video',
          sourceDuration: nextMetadata?.duration ?? DEFAULT_IMAGE_CLIP_DURATION,
        },
      ]).document;
      const nextClip = nextDocument.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.assetId === persistedAsset.id);

      if (sourceUrl?.startsWith('blob:')) URL.revokeObjectURL(sourceUrl);
      sourceFileRef.current = isVideo ? file : null;
      setSourceUrl(persistedAsset.publicUrl);
      setMetadata(nextMetadata);
      commitDocument(nextDocument);
      setSelectedClipId(nextClip?.id ?? null);
      setCurrentTime(0);
      setTimelineCursorTime(nextClip?.startTime ?? 0);
      setIsPlaying(false);
      setExportProgress(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.inspectFailed'));
    } finally {
      setIsInspecting(false);
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    if (file) void loadFile(file);
    event.target.value = '';
  };

  const loadOverlayFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError(t('errors.overlayImageOnly'));
      return;
    }
    const hasBaseVisual = document.tracks.some(
      (track) => track.kind === 'video' && track.clips.length > 0
    );
    if (!hasBaseVisual || document.duration <= 0) {
      setError(t('errors.overlayNeedsVisual'));
      return;
    }
    setError(null);
    setIsInspecting(true);
    try {
      const imageBitmap = await createImageBitmap(file);
      const persistedAsset = await uploadLocalProjectAsset({
        projectId,
        file,
        width: imageBitmap.width,
        height: imageBitmap.height,
      });
      imageBitmap.close();
      const duration = Math.min(3, document.duration);
      const startTime = Math.max(0, document.duration - duration);
      const nextDocument = applyEditorOperations(document, [
        {
          type: 'add_overlay',
          assetId: persistedAsset.id,
          sourceUrl: persistedAsset.publicUrl,
          name: file.name,
          startTime,
          duration,
          x: 0.5,
          y: 0.25,
          width: 0.7,
          opacity: 1,
          fadeIn: Math.min(0.6, duration),
        },
      ]).document;
      const nextClip = nextDocument.tracks
        .find((track) => track.kind === 'overlay')
        ?.clips.find((clip) => clip.assetId === persistedAsset.id);
      commitDocument(nextDocument);
      setSelectedClipId(nextClip?.id ?? null);
      setTimelineCursorTime(startTime);
      setIsPlaying(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.inspectFailed'));
    } finally {
      setIsInspecting(false);
    }
  };

  const handleOverlayInput = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    if (file) void loadOverlayFile(file);
    event.target.value = '';
  };

  const loadAudioFile = async (file: File) => {
    if (
      !file.type.startsWith('audio/') &&
      !/\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name)
    ) {
      setError(t('errors.audioOnly'));
      return;
    }
    setError(null);
    setIsInspecting(true);
    try {
      const audioMetadata = await inspectLocalMedia(file);
      if (!audioMetadata.hasAudio || audioMetadata.duration <= 0) {
        throw new Error(t('errors.noAudioTrack'));
      }
      const persistedAsset = await uploadLocalProjectAsset({
        projectId,
        file,
        durationMs: audioMetadata.duration * 1000,
      });
      const nextDocument = applyEditorOperations(document, [
        {
          type: 'add_clip',
          assetId: persistedAsset.id,
          sourceUrl: persistedAsset.publicUrl,
          name: file.name,
          sourceType: 'audio',
          sourceDuration: audioMetadata.duration,
          startTime: 0,
          audioRole: 'music',
        },
      ]).document;
      const nextClip = nextDocument.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.assetId === persistedAsset.id);
      commitDocument(nextDocument);
      setSelectedClipId(nextClip?.id ?? selectedClipId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.inspectFailed'));
    } finally {
      setIsInspecting(false);
    }
  };

  const handleAudioInput = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    if (file) void loadAudioFile(file);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const [file] = Array.from(event.dataTransfer.files);
    if (!file) return;
    if (
      file.type.startsWith('audio/') ||
      /\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name)
    ) {
      void loadAudioFile(file);
      return;
    }
    void loadFile(file);
  };

  const togglePlayback = async () => {
    if (!previewClip || !previewSource) {
      return;
    }
    if (previewClip.sourceType === 'image') {
      if (isPlaying) {
        stopImagePlayback();
        syncAudioTracks(timelineCurrentTime, false);
        return;
      }
      const initialOffset =
        previewOffset >= previewClip.duration - MIN_CLIP_DURATION
          ? 0
          : Math.max(0, previewOffset);
      const startedAt = performance.now() - initialOffset * 1000;
      setIsPlaying(true);
      const tick = (now: number) => {
        const offset = Math.min(
          previewClip.duration,
          Math.max(0, (now - startedAt) / 1000)
        );
        setCurrentTime(offset);
        const nextTimelineTime = previewClip.startTime + offset;
        setTimelineCursorTime(nextTimelineTime);
        syncAudioTracks(nextTimelineTime, true);
        if (offset >= previewClip.duration) {
          imagePlaybackFrameRef.current = null;
          setIsPlaying(false);
          syncAudioTracks(nextTimelineTime, false);
          return;
        }
        imagePlaybackFrameRef.current = requestAnimationFrame(tick);
      };
      imagePlaybackFrameRef.current = requestAnimationFrame(tick);
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    if (
      video.currentTime < previewSource.inPoint ||
      video.currentTime >= previewSource.outPoint
    ) {
      seek(previewSource.inPoint, previewClip.startTime);
    }
    await video.play();
  };

  const updateTrim = (edge: 'in' | 'out', value: number) => {
    if (!selectedClip || selectedClip.activeTakeId) return;
    const nextIn =
      edge === 'in'
        ? Math.min(value, selectedClip.outPoint - MIN_CLIP_DURATION)
        : selectedClip.inPoint;
    const nextOut =
      edge === 'out'
        ? Math.max(value, selectedClip.inPoint + MIN_CLIP_DURATION)
        : selectedClip.outPoint;
    commitDocument((current) =>
      applyEditorOperations(current, [
        {
          type: 'trim_clip',
          clipId: selectedClip.id,
          inPoint: nextIn,
          outPoint: nextOut,
        },
      ]).document
    );
    if (selectedClip.sourceType === 'video') {
      seek(edge === 'in' ? nextIn : nextOut);
    }
  };

  const importSrtFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_SRT_FILE_BYTES) {
      setError(t('errors.srtTooLarge'));
      return;
    }
    try {
      const srt = await file.text();
      commitDocument((current) =>
        applyEditorOperations(current, [
          { type: 'import_srt', srt, replace: true },
        ]).document
      );
    } catch {
      setError(t('errors.srtImportFailed'));
    }
  };

  const resizeSelectedImage = (duration: number) => {
    if (!selectedClip || selectedClip.sourceType !== 'image') return;
    commitDocument((current) =>
      applyEditorOperations(current, [
        {
          type: 'set_clip_duration',
          clipId: selectedClip.id,
          duration: Math.max(MIN_CLIP_DURATION, duration),
        },
      ]).document
    );
  };

  const splitAtPlayhead = () => {
    const splitClip = findVisualClipAtTimelineTime(document, timelineCurrentTime);
    if (!splitClip || splitClip.sourceType !== 'video' || splitClip.activeTakeId) {
      return;
    }
    const splitSource = getTimelineClipSource(splitClip);
    const splitSourceTime =
      splitSource.inPoint + (timelineCurrentTime - splitClip.startTime);
    const nextDocument = applyEditorOperations(document, [
      {
        type: 'split_clip',
        clipId: splitClip.id,
        sourceTime: splitSourceTime,
      },
    ]).document;
    if (nextDocument === document) return;
    commitDocument(nextDocument);
    const rightClip = nextDocument.tracks
      .flatMap((track) => track.clips)
      .find(
        (clip) =>
          clip.assetId === splitClip.assetId &&
          Math.abs(clip.inPoint - splitSourceTime) < 0.001
      );
    setSelectedClipId(rightClip?.id ?? splitClip.id);
  };

  const moveSelectedClip = (startTime: number) => {
    if (!selectedClip) return;
    let next: TimelineDocument;
    try {
      next = applyEditorOperations(document, [
        { type: 'move_clip', clipId: selectedClip.id, startTime },
      ]).document;
    } catch {
      setError(t('errors.clipOverlap'));
      return;
    }
    commitDocument(next);
  };

  const beginTimelineDrag = (
    clip: TimelineClip,
    mode: TimelineDragMode,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (mode !== 'move' && clip.activeTakeId) return;
    const timelineTrack = event.currentTarget.closest<HTMLElement>(
      '[data-timeline-track]'
    );
    if (!timelineTrack || document.duration <= 0) return;
    event.preventDefault();
    videoRef.current?.pause();
    stopImagePlayback();
    if (selectedClipId !== clip.id) selectClip(clip);

    const rect = timelineTrack.getBoundingClientRect();
    const initialPreview: TimelineClipInteractionPreview = {
      id: clip.id,
      startTime: clip.startTime,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      sourceDuration: clip.sourceDuration,
    };
    timelineDragRef.current = {
      clip,
      mode,
      originClientX: event.clientX,
      timelineWidth: rect.width,
      timelineDuration: Math.max(document.duration, 0.001),
      preview: initialPreview,
    };
    setTimelineDragPreview(initialPreview);

    const finishDrag = () => {
      const session = timelineDragRef.current;
      timelineDragRef.current = null;
      window.removeEventListener('pointermove', moveDrag);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
      setTimelineDragPreview(null);
      if (!session) return;
      const preview = session.preview;
      if (
        preview.startTime === session.clip.startTime &&
        preview.duration === session.clip.duration &&
        preview.inPoint === session.clip.inPoint &&
        preview.outPoint === session.clip.outPoint
      ) {
        return;
      }

      const operations: EditorOperation[] = [];
      if (session.mode === 'move') {
        operations.push({
          type: 'move_clip',
          clipId: session.clip.id,
          startTime: preview.startTime,
        });
      } else if (session.clip.sourceType === 'image') {
        operations.push({
          type: 'set_clip_duration',
          clipId: session.clip.id,
          duration: preview.duration,
        });
        if (session.mode === 'trim-start') {
          operations.push({
            type: 'move_clip',
            clipId: session.clip.id,
            startTime: preview.startTime,
          });
        }
      } else {
        operations.push({
          type: 'trim_clip',
          clipId: session.clip.id,
          inPoint: preview.inPoint,
          outPoint: preview.outPoint,
        });
        if (session.mode === 'trim-start') {
          operations.push({
            type: 'move_clip',
            clipId: session.clip.id,
            startTime: preview.startTime,
          });
        }
      }

      try {
        const next = applyEditorOperations(document, operations).document;
        commitDocument(next);
        const nextCursor = Math.max(
          preview.startTime,
          Math.min(
            preview.startTime + preview.duration,
            timelineCurrentTime
          )
        );
        setTimelineCursorTime(nextCursor);
        if (session.clip.sourceType === 'image') {
          setCurrentTime(nextCursor - preview.startTime);
        } else {
          setCurrentTime(preview.inPoint + (nextCursor - preview.startTime));
        }
      } catch {
        setError(t('errors.clipOverlap'));
      }
    };

    const moveDrag = (pointerEvent: PointerEvent) => {
      const session = timelineDragRef.current;
      if (!session || session.timelineWidth <= 0) return;
      const deltaTime =
        ((pointerEvent.clientX - session.originClientX) /
          session.timelineWidth) *
        session.timelineDuration;
      const preview = buildTimelineDragPreview({
        document,
        clip: session.clip,
        mode: session.mode,
        deltaTime,
      });
      session.preview = preview;
      setTimelineDragPreview(preview);
    };

    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
  };

  const deleteSelectedClip = (ripple: boolean) => {
    if (!selectedClip) return;
    commitDocument(
      applyEditorOperations(document, [
        { type: 'remove_clip', clipId: selectedClip.id, ripple },
      ]).document
    );
    setSelectedClipId(null);
    videoRef.current?.pause();
    stopImagePlayback();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }
      const commandKey = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (commandKey && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoTimeline();
        else undoTimeline();
        return;
      }
      if (commandKey && key === 'b') {
        event.preventDefault();
        splitAtPlayhead();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        void togglePlayback();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedClip) return;
        event.preventDefault();
        deleteSelectedClip(false);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        seekTimeline(
          timelineCurrentTime + direction * (event.shiftKey ? 1 : 0.04)
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const createDerivedSelection = async () => {
    if (!selectedClip || !selectedSource) return null;
    setError(null);
    setIsExporting(true);
    setExportProgress(0);
    try {
      let file = sourceFileRef.current;
      if (!file || selectedSource.assetId !== clips[0]?.assetId) {
        const response = await fetch(selectedSource.sourceUrl);
        if (!response.ok) throw new Error(t('errors.sourceUnavailable'));
        const blob = await response.blob();
        file = new File([blob], selectedSource.name, {
          type: blob.type || 'video/mp4',
        });
        sourceFileRef.current = file;
      }
      const blob = await exportTrimmedMp4({
        file,
        start: selectedSource.inPoint,
        end: selectedSource.outPoint,
        onProgress: setExportProgress,
      });
      const filename = `${safeFilename(selectedSource.name)}-${selectedSource.inPoint.toFixed(2)}-${selectedSource.outPoint.toFixed(2)}.mp4`;
      const derivedFile = new File([blob], filename, { type: 'video/mp4' });
      const derivedMetadata = await inspectLocalMedia(derivedFile);
      const asset = await uploadLocalProjectAsset({
        projectId,
        file: derivedFile,
        assetClass: 'derived',
        width: derivedMetadata.width ?? undefined,
        height: derivedMetadata.height ?? undefined,
        durationMs: selectedClip.duration * 1000,
        metadata: {
          parentAssetId: selectedSource.assetId,
          sourceInSec: selectedSource.inPoint,
          sourceOutSec: selectedSource.outPoint,
          operation: 'timeline_extract',
          timelineId: document.id,
          clipId: selectedClip.id,
        },
      });
      return { asset, file: derivedFile, blob, filename };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.exportFailed'));
      return null;
    } finally {
      setIsExporting(false);
    }
  };

  const exportSelection = () =>
    void (async () => {
      const blockingDiagnostic = diagnoseTimeline(document).find(
        (diagnostic) => diagnostic.severity === 'error'
      );
      if (blockingDiagnostic) {
        setError(t(`diagnostics.${blockingDiagnostic.code}`));
        return;
      }

      setError(null);
      setIsExporting(true);
      setExportProgress(0);
      const controller = new AbortController();
      exportControllerRef.current = controller;
      try {
        const blob = await exportTimelineMp4({
          document,
          signal: controller.signal,
          onProgress: setExportProgress,
        });
        const filename = `${safeFilename(document.name)}-timeline.mp4`;
        const renderFile = new File([blob], filename, { type: 'video/mp4' });
        const renderMetadata = await inspectLocalMedia(renderFile);
        const asset = await uploadLocalProjectAsset({
          projectId,
          file: renderFile,
          assetClass: 'derived',
          width: renderMetadata.width ?? undefined,
          height: renderMetadata.height ?? undefined,
          durationMs: document.duration * 1000,
          metadata: {
            operation: 'timeline_render',
            timelineId: document.id,
            clipCount: clips.length,
          },
        });
        const nextDocument = applyEditorOperations(document, [
          {
            type: 'set_render',
            assetId: asset.id,
            publicUrl: asset.publicUrl,
          },
        ]).document;
        commitDocument(nextDocument);
        const saved = await saveTimelineThroughCommand({
          projectId,
          document: nextDocument,
          expectedRevision: timelineVersionRef.current,
        });
        timelineVersionRef.current = saved.version;
        lastSavedDocumentRef.current = saved.document;
      persistence.checkpoint();
        await apiJsonPost(
          `/api/app/projects/${encodeURIComponent(projectId)}/timeline`,
          {}
        );
        downloadBlob(blob, filename);
      } catch (cause) {
        setError(
          cause instanceof DOMException && cause.name === 'AbortError'
            ? t('errors.exportCancelled')
            : cause instanceof Error
              ? cause.message
              : t('errors.exportFailed')
        );
      } finally {
        exportControllerRef.current = null;
        setIsExporting(false);
      }
    })();

  const addTimelineToCanvas = async () => {
    try {
      const saved = await saveTimelineThroughCommand({
        projectId,
        document,
        expectedRevision: timelineVersionRef.current,
      });
      timelineVersionRef.current = saved.version;
      lastSavedDocumentRef.current = saved.document;
      persistence.checkpoint();
      await apiJsonPost(
        `/api/app/projects/${encodeURIComponent(projectId)}/timeline`,
        {}
      );
      setRedoStatus(t('status.canvasAdded'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.canvasNodeFailed'));
    }
  };

  const runRedo = async () => {
    if (!selectedClip || selectedClip.sourceType !== 'video') return;
    setIsRedoing(true);
    setError(null);
    setRedoStatus(t('redo.preparing'));
    try {
      const derived = await createDerivedSelection();
      if (!derived) return;
      const result = await redoTimelineSelection({
        projectId,
        file: derived.file,
        prompt: redoPrompt,
        durationSec: selectedClip.duration,
        onStatus: (status) => setRedoStatus(t(`redo.status.${status}`)),
      });
      const resultFileResponse = await fetch(result.resultUrl);
      if (!resultFileResponse.ok) throw new Error(t('errors.sourceUnavailable'));
      const resultBlob = await resultFileResponse.blob();
      const resultFile = new File([resultBlob], 'cloud-api-redo.mp4', {
        type: resultBlob.type || 'video/mp4',
      });
      const resultMetadata = await inspectLocalMedia(resultFile);
      const assets = await fetchRecentAssets(projectId);
      const resultAsset = assets.videos.find(
        (asset) =>
          asset.id === result.assetId || asset.publicUrl === result.resultUrl
      );
      if (!resultAsset && !result.assetId) {
        throw new Error(t('errors.redoAssetMissing'));
      }
      commitDocument((current) =>
        applyEditorOperations(current, [
          {
            type: 'add_take',
            clipId: selectedClip.id,
            take: {
              assetId: resultAsset?.id ?? result.assetId!,
              sourceUrl: result.resultUrl,
              name: `${selectedClip.name} · AI Take`,
              sourceDuration: resultMetadata.duration,
              sourceGenerationId: result.generationId,
              prompt: redoPrompt.trim(),
            },
          },
        ]).document
      );
      setRedoStatus(t('redo.ready'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('errors.redoFailed'));
      setRedoStatus('');
    } finally {
      setIsRedoing(false);
    }
  };

  const activateTake = (takeId: string | null) => {
    if (!selectedClip) return;
    try {
      const next = applyEditorOperations(document, [
        { type: 'activate_take', clipId: selectedClip.id, takeId },
      ]).document;
      const nextClip = findTimelineClip(next, selectedClip.id);
      if (!nextClip) return;
      commitDocument(next);
      selectClip(nextClip);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not switch take');
    }
  };

  return (
    <div
      className="vh-product-shell flex min-h-0 flex-1 flex-col bg-[var(--vh-bg)] text-[var(--vh-text-1)]"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <TimelineDraftRecovery canRestore={persistence.canRestore} open={persistence.draftReviewOpen} records={persistence.drafts} error={persistence.draftError} busy={persistence.recovering} onClose={persistence.closeDrafts} onRestore={persistence.restoreDraft} onDiscard={persistence.discardDraft} onReload={persistence.reloadDrafts} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm,image/*,video/*"
        className="hidden"
        onChange={handleFileInput}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,.mp3,.wav,.m4a,.aac,.ogg"
        className="hidden"
        onChange={handleAudioInput}
      />
      <input
        ref={overlayInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/*"
        className="hidden"
        onChange={handleOverlayInput}
      />
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt,application/x-subrip,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (file) void importSrtFile(file);
        }}
      />
      {clips
        .filter((clip) => clip.sourceType === 'audio')
        .map((clip) => (
          <audio
            key={clip.id}
            ref={(element) => {
              if (element) audioElementsRef.current.set(clip.id, element);
              else audioElementsRef.current.delete(clip.id);
            }}
            src={getTimelineClipSource(clip).sourceUrl}
            preload="auto"
            className="hidden"
          />
        ))}

      {selectedClip && selectedClip.takes.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--vh-border)] bg-[var(--vh-surface)] px-4 py-2">
          <label htmlFor="clip-take" className="shrink-0 text-xs font-medium">Clip take</label>
          <select id="clip-take" aria-label="Clip take" value={selectedClip.activeTakeId ?? ''}
            disabled={document.tracks.some(track => track.id === selectedClip.trackId && track.locked)}
            onChange={event => activateTake(event.target.value || null)}
            className="h-9 min-w-0 max-w-sm flex-1 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 text-xs">
            <option value="">Original · {selectedClip.name}</option>
            {selectedClip.takes.map((take, index) => <option key={take.id} value={take.id}>Take {index + 1} · {take.name}</option>)}
          </select>
          <span className="hidden text-xs text-[var(--vh-text-2)] sm:inline">Timing stays unchanged</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[292px] shrink-0 flex-col border-r border-[var(--vh-border)] bg-[var(--vh-surface)] lg:flex">
          <div className="flex h-[74px] items-end gap-5 border-b border-[var(--vh-border)] px-5 pb-3">
            <Action
              type="button"
              aria-current="page"
              className="relative flex h-9 items-center gap-2 text-xs font-[560] text-[var(--vh-text-1)]"
            >
              <FileVideo2 className="size-4" />
              {t('media.tab')}
              <span className="absolute inset-x-0 -bottom-3 h-0.5 rounded-full bg-white" />
            </Action>
            <span className="text-xs font-[520] text-[var(--vh-text-2)]">
              {t('media.localOnly')}
            </span>
          </div>

          <div className="border-b border-[var(--vh-border)] p-4">
            <div className="flex gap-2">
              <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-[var(--vh-control)] px-3 text-[var(--vh-text-2)] ring-1 ring-inset ring-[var(--vh-border)] focus-within:ring-[var(--vh-border)]">
                <Search className="size-3.5 shrink-0" />
                <input
                  value={mediaSearch}
                  onChange={(event) => setMediaSearch(event.target.value)}
                  placeholder={t('media.search')}
                  className="min-w-0 flex-1 bg-transparent text-xs text-[var(--vh-text-1)] outline-none placeholder:text-[var(--vh-text-2)]"
                />
              </label>
              <div className="flex rounded-lg bg-[var(--vh-control)] p-0.5 ring-1 ring-inset ring-[var(--vh-border)]">
                <Action
                  type="button"
                  onClick={() => setMediaView('grid')}
                  aria-label={t('media.gridView')}
                  aria-pressed={mediaView === 'grid'}
                  className={`grid size-8 place-items-center rounded-md transition ${
                    mediaView === 'grid'
                      ? 'bg-[var(--vh-control)] text-[var(--vh-text-1)]'
                      : 'text-[var(--vh-text-2)] hover:text-[var(--vh-text-2)]'
                  }`}
                >
                  <Grid2X2 className="size-3.5" />
                </Action>
                <Action
                  type="button"
                  onClick={() => setMediaView('list')}
                  aria-label={t('media.listView')}
                  aria-pressed={mediaView === 'list'}
                  className={`grid size-8 place-items-center rounded-md transition ${
                    mediaView === 'list'
                      ? 'bg-[var(--vh-control)] text-[var(--vh-text-1)]'
                      : 'text-[var(--vh-text-2)] hover:text-[var(--vh-text-2)]'
                  }`}
                >
                  <List className="size-3.5" />
                </Action>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Action
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] text-xs font-[540] text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]"
              >
                <Upload className="size-3.5" />
                {t('media.importVisual')}
              </Action>
              <Action
                type="button"
                onClick={() => audioInputRef.current?.click()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] text-xs font-[540] text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]"
              >
                <Music2 className="size-3.5" />
                {t('media.importAudio')}
              </Action>
              <Action
                type="button"
                onClick={() => srtInputRef.current?.click()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] text-xs font-[540] text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]"
              >
                <Subtitles className="size-3.5" />
                {t('media.importSrt')}
              </Action>
              <Action
                type="button"
                onClick={() => overlayInputRef.current?.click()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] text-xs font-[540] text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]"
              >
                <Layers2 className="size-3.5" />
                {t('media.importOverlay')}
              </Action>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {projectMedia.length > 0 ? (
              <div
                className={
                  mediaView === 'grid'
                    ? 'grid grid-cols-2 gap-2.5'
                    : 'flex flex-col gap-2'
                }
              >
                {projectMedia.map((clip) => (
                  <Action
                    key={clip.assetId}
                    type="button"
                    onClick={() => selectClip(clip, Math.max(clip.startTime, timelineCurrentTime))}
                    className={`group min-w-0 overflow-hidden rounded-[10px] border text-left transition ${
                      selectedClip?.assetId === clip.assetId
                        ? 'border-[var(--vh-accent)]/70 bg-[var(--vh-accent)]/[0.08]'
                        : 'border-[var(--vh-border)] bg-[var(--vh-control)] hover:border-[var(--vh-border)] hover:bg-[var(--vh-control)]'
                    } ${mediaView === 'list' ? 'flex items-center gap-2.5 p-2' : 'p-1.5'}`}
                  >
                    <span
                      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-[7px] bg-[var(--vh-control)] ${
                        mediaView === 'list' ? 'size-12' : 'aspect-video w-full'
                      }`}
                    >
                      {clip.sourceType === 'image' ? (
                        <img src={clip.sourceUrl} alt="" className="size-full object-cover" />
                      ) : clip.sourceType === 'video' ? (
                        <video
                          src={clip.sourceUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full object-cover opacity-80"
                          onLoadedMetadata={(event) =>
                            seekStaticVideoPreview(event.currentTarget)
                          }
                        />
                      ) : (
                        <Music2 className="size-4 text-[var(--vh-graph)]" />
                      )}
                      <span className="absolute bottom-1 right-1 rounded bg-black/72 px-1 py-0.5 text-[8px] font-[560] tabular-nums text-white/90">
                        {formatTime(clip.duration)}
                      </span>
                    </span>
                    <span className={`block min-w-0 ${mediaView === 'grid' ? 'px-1 pb-1 pt-2' : 'flex-1'}`}>
                      <span className="block truncate text-[11px] font-[550] text-[var(--vh-text-1)]">
                        {clip.name}
                      </span>
                      <span className="mt-0.5 block text-[9px] capitalize text-[var(--vh-text-2)]">
                        {t(`clipInspector.type.${clip.sourceType}`)}
                      </span>
                    </span>
                  </Action>
                ))}
              </div>
            ) : (
              <Action
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-full min-h-56 w-full flex-col items-center justify-center rounded-xl border border-dashed border-[var(--vh-border)] px-5 text-center text-[var(--vh-text-2)] transition hover:border-[var(--vh-border)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-2)]"
              >
                <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-[var(--vh-control)]">
                  <Upload className="size-5" />
                </span>
                <span className="text-xs font-[560] text-[var(--vh-text-2)]">
                  {mediaSearch ? t('media.noResults') : t('media.empty')}
                </span>
                <span className="mt-2 max-w-44 text-[11px] leading-5">
                  {t('media.drop')}
                </span>
              </Action>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--vh-border)] px-3 sm:px-4">
            <div className="flex items-center gap-2 text-xs text-[var(--vh-text-2)]">
              <span className="inline-flex size-7 items-center justify-center rounded-md border border-[var(--vh-border)] bg-[var(--vh-control)] text-[var(--vh-text-2)]">
                <FileVideo2 className="size-3.5" />
              </span>
              <span>{t('status.ready')}</span>
              <Action aria-label="Review local drafts" onClick={persistence.openDrafts} className="rounded-md px-2 py-1 text-xs hover:bg-[var(--vh-control)]">Drafts</Action>
              {saveStatus !== 'idle' ? (
                <span className="text-[var(--vh-text-2)]">
                  {saveStatus === 'saving' ? t('status.saving') : t('status.saved')}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden items-center rounded-lg border border-[var(--vh-border)] sm:flex">
                <Action
                  type="button"
                  onClick={undoTimeline}
                  disabled={!canUndo}
                  className="grid size-8 place-items-center text-[var(--vh-text-2)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:opacity-25"
                  aria-label={t('actions.undo')}
                  title={t('actions.undo')}
                >
                  <Undo2 className="size-3.5" />
                </Action>
                <Action
                  type="button"
                  onClick={redoTimeline}
                  disabled={!canRedo}
                  className="grid size-8 place-items-center border-l border-[var(--vh-border)] text-[var(--vh-text-2)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:opacity-25"
                  aria-label={t('actions.redoEdit')}
                  title={t('actions.redoEdit')}
                >
                  <Redo2 className="size-3.5" />
                </Action>
              </div>
              <Action
                type="button"
                onClick={() => setInspectorOpen((current) => !current)}
                className={`grid size-8 place-items-center rounded-lg border transition ${
                  isInspectorOpen
                    ? 'border-[var(--vh-accent)]/35 bg-[var(--vh-accent)]/10 text-[var(--vh-accent)]'
                    : 'border-[var(--vh-border)] bg-[var(--vh-control)] text-[var(--vh-text-2)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]'
                }`}
                aria-label={t(isInspectorOpen ? 'panel.close' : 'panel.open')}
                title={t(isInspectorOpen ? 'panel.close' : 'panel.open')}
                aria-pressed={isInspectorOpen}
              >
                <SlidersHorizontal className="size-3.5" />
              </Action>
              <Action
                type="button"
                onClick={() =>
                  isExporting
                    ? exportControllerRef.current?.abort()
                    : exportSelection()
                }
                disabled={
                  !isExporting && !clips.some((clip) => clip.sourceType !== 'audio')
                }
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  isExporting
                    ? 'border border-[var(--vh-border)] bg-[var(--vh-control)] hover:bg-[var(--vh-control)]'
                    : 'bg-[var(--vh-accent)] hover:brightness-110'
                }`}
              >
                <Download className="size-3.5" />
                {isExporting
                  ? t('actions.cancelExport', {
                      progress: Math.round(exportProgress * 100),
                    })
                  : t('actions.export')}
              </Action>
            </div>
          </div>

          <div className="flex h-9 shrink-0 items-center border-b border-[var(--vh-border)] bg-[var(--vh-surface)] px-4 text-xs font-[570] text-[var(--vh-text-2)]">
            {t('player.title')}
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[var(--vh-control)] p-4 sm:p-8 [container-type:size]">
            {sourceUrl && previewClip ? (
              <div
                ref={previewFrameRef}
                className="relative shrink-0 overflow-hidden rounded-xl bg-black shadow-lg [container-type:size]"
                style={{
                  aspectRatio: `${previewDimensions.width} / ${previewDimensions.height}`,
                  width: `min(100cqw, calc(100cqh * ${previewDimensions.width / previewDimensions.height}))`,
                }}
              >
              {previewClip.sourceType === 'image' ? (
                <img
                  src={sourceUrl}
                  alt={previewClip.name}
                  className="size-full object-contain"

                />
              ) : (
                <video
                ref={videoRef}
                src={sourceUrl}
                playsInline
                className="size-full object-contain"
                onLoadedMetadata={(event) => {
                  if (!previewClip || !previewSource) return;

                  const target = Math.max(
                    previewSource.inPoint,
                    Math.min(previewSource.outPoint, currentTime)
                  );
                  event.currentTarget.currentTime = target;
                }}
                onPlay={(event) => {
                  setIsPlaying(true);
                  if (!previewClip || !previewSource) return;
                  syncAudioTracks(
                    previewClip.startTime +
                      (event.currentTarget.currentTime - previewSource.inPoint),
                    true
                  );
                }}
                onPause={(event) => {
                  setIsPlaying(false);
                  if (!previewClip || !previewSource) return;
                  syncAudioTracks(
                    previewClip.startTime +
                      (event.currentTarget.currentTime - previewSource.inPoint),
                    false
                  );
                }}
                onTimeUpdate={(event) => {
                  const time = event.currentTarget.currentTime;
                  if (previewClip && previewSource && time >= previewSource.outPoint) {
                    event.currentTarget.pause();
                    event.currentTarget.currentTime = previewSource.outPoint;
                    setCurrentTime(previewSource.outPoint);
                    setTimelineCursorTime(
                      previewClip.startTime + previewClip.duration
                    );
                    return;
                  }
                  setCurrentTime(time);
                  if (previewClip && previewSource) {
                    const nextTimelineTime =
                      previewClip.startTime + (time - previewSource.inPoint);
                    setTimelineCursorTime(nextTimelineTime);
                    syncAudioTracks(
                      nextTimelineTime,
                      !event.currentTarget.paused
                    );
                  }
                }}
              />
              )}
              {activeOverlays.map((overlay) => {
                const pose = overlayTransformAt(overlay, timelineCurrentTime)!;
                const position =
                  overlayDragPreview?.clipId === overlay.id
                    ? overlayDragPreview
                    : pose;
                const selected = selectedClipId === overlay.id;
                return (
                  <Action
                    key={overlay.id}
                    disabled={document.tracks.some(track => track.id === overlay.trackId && track.locked)}
                    type="button"
                    aria-label={`${t('overlay.dragLabel')}: ${overlay.name}`}
                    title={t('overlay.dragHint')}
                    onPointerDown={(event) => startOverlayDrag(event, overlay)}
                    onPointerMove={moveOverlayDrag}
                    onPointerUp={finishOverlayDrag}
                    onPointerCancel={finishOverlayDrag}
                    onKeyDown={(event) => nudgeOverlay(event, overlay)}
                    className={`absolute z-10 m-0 touch-none border-0 bg-transparent p-0 text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[var(--vh-graph)] ${
                      selected
                        ? 'cursor-grab ring-1 ring-[var(--vh-graph)] shadow-none active:cursor-grabbing'
                        : 'cursor-move hover:ring-1 hover:ring-[var(--vh-border)]'
                    }`}
                    style={{
                      left: `${position.x * 100}%`,
                      top: `${position.y * 100}%`,
                      width: `${pose.width * 100}%`,
                      opacity: overlayOpacityAt(overlay, timelineCurrentTime),
                      transform: `translate(-50%, -50%) rotate(${pose.rotation}deg)`,
                    }}
                  >
                    <img
                      src={getTimelineClipSource(overlay).sourceUrl}
                      alt=""
                      draggable={false}
                      className="block h-auto w-full select-none"
                    />
                    {selected ? (
                      <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--vh-border)] bg-[var(--vh-surface)]/92 px-2 py-1 text-[9px] font-[560] text-[var(--vh-text-2)] shadow-lg backdrop-blur-md">
                        {t('overlay.dragHint')}
                      </span>
                    ) : null}
                  </Action>
                );
              })}
              {activeCaption?.text ? (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
                  style={{ bottom: `${activeCaptionStyle.bottomOffset * 100}%` }}
                >
                  <p
                    className="whitespace-pre-line break-words rounded-lg px-4 py-2 text-center text-white"
                    style={{
                      maxWidth: `${activeCaptionStyle.maxWidth * 100}%`,
                      fontWeight: activeCaptionStyle.fontWeight,
                      lineHeight: activeCaptionStyle.lineHeight,
                      textTransform: activeCaptionStyle.uppercase
                        ? 'uppercase'
                        : 'none',
                      background:
                        activeCaptionStyle.backgroundStyle ?? 'transparent',
                      WebkitTextStroke: activeCaptionStyle.strokeStyle
                        ? `${Math.max(1, activeCaptionStyle.strokeScale * 8)}px ${activeCaptionStyle.strokeStyle}`
                        : undefined,
                      paintOrder: 'stroke fill',
                      textShadow: activeCaptionStyle.strokeStyle
                        ? '0 2px 8px rgba(0,0,0,0.45)'
                        : '0 8px 24px rgba(0,0,0,0.35)',
                      fontSize: `clamp(10px, ${activeCaptionStyle.fontScale * 100}cqh, 80px)`,
                    }}
                  >
                    {activeCaption.text}
                  </p>
                </div>
              ) : null}
              </div>
            ) : (
              <Action
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex max-w-md flex-col items-center rounded-2xl border border-dashed border-[var(--vh-border)] bg-[var(--vh-control)] px-10 py-12 text-center transition hover:border-[var(--vh-accent)]/45 hover:bg-[var(--vh-control)]"
              >
                <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-[var(--vh-accent)]/12 text-[var(--vh-accent)]">
                  <ImageIcon className="size-6" />
                </span>
                <span className="text-sm font-semibold text-[var(--vh-text-1)]">
                  {isInspecting ? t('status.reading') : t('empty.title')}
                </span>
                <span className="mt-2 text-xs leading-5 text-[var(--vh-text-2)]">
                  {t('empty.description')}
                </span>
              </Action>
            )}

            {redoOpen && selectedClip?.sourceType === 'video' ? (
              <aside className="absolute bottom-4 right-4 top-4 z-20 flex w-[min(340px,calc(100%-2rem))] flex-col rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-surface)]/96 p-4 shadow-lg backdrop-blur-xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--vh-text-1)]">{t('redo.title')}</p>
                    <p className="mt-1 text-[11px] leading-4 text-[var(--vh-text-2)]">
                      {t('redo.description')}
                    </p>
                  </div>
                  <Action
                    type="button"
                    onClick={() => setRedoOpen(false)}
                    className="text-lg leading-none text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]"
                    aria-label={t('redo.close')}
                  >
                    ×
                  </Action>
                </div>
                <div className="mt-4 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] px-3 py-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-[var(--vh-text-2)]">Seedance 2</span>
                    <span className="font-[520] tabular-nums tracking-[-0.01em] text-[var(--vh-text-2)]">{selectedClip.duration.toFixed(2)}s</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[var(--vh-text-2)]">{t('redo.billingNotice')}</p>
                </div>
                <textarea
                  value={redoPrompt}
                  onChange={(event) => setRedoPrompt(event.target.value)}
                  placeholder={t('redo.placeholder')}
                  maxLength={5000}
                  className="mt-3 min-h-24 resize-none rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] px-3 py-2.5 text-xs leading-5 text-[var(--vh-text-1)] outline-none placeholder:text-[var(--vh-text-2)] focus:border-[var(--vh-accent)]/55"
                />
                <Action
                  type="button"
                  onClick={() => void runRedo()}
                  disabled={isRedoing || !redoPrompt.trim()}
                  className="mt-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[var(--vh-accent)] px-3 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
                >
                  <Sparkles className="size-3.5" />
                  {isRedoing ? t('redo.running') : t('redo.confirm')}
                </Action>
                {redoStatus ? (
                  <p className="mt-2 text-center text-[10px] text-[var(--vh-text-2)]">{redoStatus}</p>
                ) : null}
                <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-t border-[var(--vh-border)] pt-3">
                  <p className="mb-2 text-[10px] font-[540] tracking-[-0.01em] text-[var(--vh-text-2)]">
                    {t('redo.takes')}
                  </p>
                  <Action
                    type="button"
                    onClick={() => activateTake(null)}
                    className={`mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[11px] ${
                      !selectedClip.activeTakeId
                        ? 'border-[var(--vh-graph)]/50 bg-[var(--vh-graph)]/10 text-[var(--vh-text-1)]'
                        : 'border-[var(--vh-border)] text-[var(--vh-text-2)] hover:bg-[var(--vh-control)]'
                    }`}
                  >
                    <span>{t('redo.original')}</span>
                    {!selectedClip.activeTakeId ? <span>✓</span> : null}
                  </Action>
                  {selectedClip.takes.map((take, index) => (
                    <Action
                      key={take.id}
                      type="button"
                      onClick={() => activateTake(take.id)}
                      className={`mb-2 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[11px] ${
                        selectedClip.activeTakeId === take.id
                          ? 'border-[var(--vh-accent)]/55 bg-[var(--vh-accent)]/10 text-[var(--vh-text-1)]'
                          : 'border-[var(--vh-border)] text-[var(--vh-text-2)] hover:bg-[var(--vh-control)]'
                      }`}
                    >
                      <span className="min-w-0 truncate">Take {index + 1} · {take.prompt || take.name}</span>
                      {selectedClip.activeTakeId === take.id ? <span>✓</span> : null}
                    </Action>
                  ))}
                  {selectedClip.activeTakeId ? (
                    <Action
                      type="button"
                      onClick={() => activateTake(null)}
                      className="mt-1 inline-flex items-center gap-1.5 text-[10px] text-[var(--vh-text-2)] hover:text-[var(--vh-text-1)]"
                    >
                      <RotateCcw className="size-3" />
                      {t('redo.rollback')}
                    </Action>
                  ) : null}
                </div>
              </aside>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-[var(--vh-border)] bg-[var(--vh-surface)]">
            <div className="flex h-12 items-center justify-center gap-3 border-b border-[var(--vh-border)] px-4">
              <span className="w-16 text-right text-[11px] font-[520] tabular-nums tracking-[-0.01em] text-[var(--vh-text-2)]">
                {formatTime(timelineCurrentTime)}
              </span>
              <Action
                type="button"
                onClick={() => seekTimeline(timelineCurrentTime - 5)}
                disabled={!previewClip}
                className="grid size-8 place-items-center rounded-lg text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:opacity-25"
                aria-label={t('actions.skipBack')}
                title={t('actions.skipBack')}
              >
                <SkipBack className="size-3.5" />
              </Action>
              <Action
                type="button"
                onClick={() => void togglePlayback()}
                disabled={!previewClip}
                className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--vh-accent)] text-white shadow-none transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={isPlaying ? t('actions.pause') : t('actions.play')}
                title={`${isPlaying ? t('actions.pause') : t('actions.play')} · Space`}
              >
                {isPlaying ? (
                  <Pause className="size-4 fill-current" />
                ) : (
                  <Play className="ml-0.5 size-4 fill-current" />
                )}
              </Action>
              <Action
                type="button"
                onClick={() => seekTimeline(timelineCurrentTime + 5)}
                disabled={!previewClip}
                className="grid size-8 place-items-center rounded-lg text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:opacity-25"
                aria-label={t('actions.skipForward')}
                title={t('actions.skipForward')}
              >
                <SkipForward className="size-3.5" />
              </Action>
              <span className="w-16 text-[11px] font-[520] tabular-nums tracking-[-0.01em] text-[var(--vh-text-2)]">
                {formatTime(document.duration)}
              </span>
            </div>

            <div className="flex h-10 items-center gap-1 border-b border-[var(--vh-border)] px-3">
              <Action
                type="button"
                onClick={undoTimeline}
                disabled={!canUndo}
                className="grid size-8 place-items-center rounded-lg text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:opacity-25"
                aria-label={t('actions.undo')}
                title={t('actions.undo')}
              >
                <Undo2 className="size-3.5" />
              </Action>
              <Action
                type="button"
                onClick={redoTimeline}
                disabled={!canRedo}
                className="grid size-8 place-items-center rounded-lg text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:opacity-25"
                aria-label={t('actions.redoEdit')}
                title={t('actions.redoEdit')}
              >
                <Redo2 className="size-3.5" />
              </Action>
              <Action
                type="button"
                onClick={splitAtPlayhead}
                disabled={!canSplitAtPlayhead}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-[520] text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:opacity-25"
                title={`${t('actions.split')} · ⌘/Ctrl+B`}
              >
                <Scissors className="size-3.5" />
                {t('actions.split')}
              </Action>
              <Action
                type="button"
                onClick={() => deleteSelectedClip(false)}
                disabled={!selectedClip}
                className="grid size-8 place-items-center rounded-lg text-[var(--vh-text-2)] transition hover:bg-red-400/10 hover:text-red-800 disabled:opacity-25"
                aria-label={t('timeline.delete')}
                title={t('timeline.delete')}
              >
                <Trash2 className="size-3.5" />
              </Action>
              <span className="ml-auto rounded-md border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 py-1 text-[9px] font-[520] text-[var(--vh-text-2)]">
                {t('timeline.dragHint')}
              </span>
            </div>

            <div className="max-h-56 min-h-44 overflow-auto">
              <div className="grid min-w-[720px] grid-cols-[104px_1fr]">
                <div className="flex h-8 items-center border-b border-r border-[var(--vh-border)] px-3 text-[10px] font-[540] tracking-[-0.01em] text-[var(--vh-text-2)]">
                  {t('timeline.title')}
                </div>
                <Action
                  type="button"
                  aria-label={t('timeline.seek')}
                  title={t('timeline.seekHint')}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    seekTimeline(
                      timelineTimeFromClientX({
                        clientX: event.clientX,
                        left: rect.left,
                        width: rect.width,
                        duration: timelineDisplayDuration,
                      })
                    );
                  }}
                  className="relative h-8 border-b border-[var(--vh-border)] bg-[var(--vh-control)] text-left"
                >
                  {[0, 0.25, 0.5, 0.75, 1].map((point) => (
                    <span
                      key={point}
                      className="absolute top-2 text-[9px] font-[500] tabular-nums tracking-[-0.01em] text-[var(--vh-text-2)]"
                      style={{ left: `${point * 100}%` }}
                    >
                      {formatTime(timelineDisplayDuration * point)}
                    </span>
                  ))}
                  <span
                    className="pointer-events-none absolute inset-y-0 z-20 w-px bg-[var(--vh-accent)]/85 shadow-none"
                    style={{
                      left: `${
                        (timelineCurrentTime / timelineDisplayDuration) * 100
                      }%`,
                    }}
                  />
                </Action>
                {document.tracks.map((track) => (
                  <div key={track.id} className="contents">
                    <div className="flex h-16 items-center gap-2.5 border-b border-r border-[var(--vh-border)] px-3 text-[11px] font-[520] text-[var(--vh-text-2)]">
                      {track.kind === 'audio' ? (
                        <Volume2 className="size-3.5" />
                      ) : track.kind === 'caption' ? (
                        <Subtitles className="size-3.5" />
                      ) : track.kind === 'overlay' ? (
                        <Layers2 className="size-3.5" />
                      ) : (
                        <FileVideo2 className="size-3.5" />
                      )}
                      {track.kind === 'audio'
                        ? t('timeline.audioTrack')
                        : track.kind === 'caption'
                          ? t('timeline.captionTrack')
                          : track.kind === 'overlay'
                            ? t('timeline.overlayTrack')
                            : t('timeline.visualTrack')}
                    </div>
                    <div
                      data-timeline-track
                      className="relative h-16 cursor-text border-b border-[var(--vh-border)] bg-[var(--vh-control)]"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        seekTimeline(
                          timelineTimeFromClientX({
                            clientX: event.clientX,
                            left: rect.left,
                            width: rect.width,
                            duration: timelineDisplayDuration,
                          })
                        );
                      }}
                    >
                      {track.clips.map((clip) => {
                        const displayedClip =
                          timelineDragPreview?.id === clip.id
                            ? { ...clip, ...timelineDragPreview }
                            : clip;
                        return (
                          <TimelineClipBlock
                            key={clip.id}
                            clip={displayedClip}
                            totalDuration={timelineDisplayDuration}
                            selected={selectedClipId === clip.id}
                            onSelect={() => selectClip(clip)}
                            onPointerAction={(mode, event) =>
                              beginTimelineDrag(clip, mode, event)
                            }
                            trimStartLabel={t('timeline.trimStart')}
                            trimEndLabel={t('timeline.trimEnd')}
                          />
                        );
                      })}
                      {track.kind !== 'caption' ? (
                        <span
                          className="pointer-events-none absolute inset-y-0 z-20 w-px bg-white shadow-none"
                          style={{
                            left: `${
                              (timelineCurrentTime / timelineDisplayDuration) *
                              100
                            }%`,
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <EditorInspectorPanel open={isInspectorOpen} narrow={isInspectorNarrow} setOpen={setInspectorOpen} title={t('panel.title')}>
          <div className="flex h-12 items-center justify-between border-b border-[var(--vh-border)] px-4">
            <div className="flex items-center gap-2 text-sm font-[600] text-[var(--vh-text-1)]">
              <SlidersHorizontal className="size-4 text-[var(--vh-text-2)]" />
              {t('panel.title')}
            </div>
            <Action
              type="button"
              onClick={() => setInspectorOpen(false)}
              className="grid size-7 place-items-center rounded-md text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]"
              aria-label={t('panel.close')}
              title={t('panel.close')}
            >
              <X className="size-3.5" />
            </Action>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedClip && displayedSelectedClip ? (
              <>
                <div className="flex items-center gap-3 border-b border-[var(--vh-border)] pb-4">
                  <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--vh-control)] text-[var(--vh-text-2)]">
                    {selectedIsOverlay ? (
                      <Layers2 className="size-4" />
                    ) : selectedClip.sourceType === 'image' ? (
                      <ImageIcon className="size-4" />
                    ) : selectedClip.sourceType === 'video' ? (
                      <FileVideo2 className="size-4" />
                    ) : selectedClip.sourceType === 'caption' ? (
                      <Subtitles className="size-4" />
                    ) : (
                      <Volume2 className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-[580] text-[var(--vh-text-1)]">
                      {selectedClip.name}
                    </span>
                    <span className="mt-1 block text-[10px] text-[var(--vh-text-2)]">
                      {t(
                        `clipInspector.type.${
                          selectedIsOverlay ? 'overlay' : selectedClip.sourceType
                        }`
                      )}{' '}
                      ·{' '}
                      {displayedSelectedClip.duration.toFixed(2)}s
                    </span>
                  </span>
                </div>

                <div className="py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[10px] font-[600] uppercase tracking-[0.08em] text-[var(--vh-text-2)]">
                      {t('panel.properties')}
                    </p>
                    <Action
                      type="button"
                      onClick={() => setExactControlsOpen((value) => !value)}
                      aria-expanded={exactControlsOpen}
                      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10px] transition ${
                        exactControlsOpen
                          ? 'border-[var(--vh-border)] bg-[var(--vh-control)] text-[var(--vh-text-2)]'
                          : 'border-[var(--vh-border)] text-[var(--vh-text-2)] hover:text-[var(--vh-text-2)]'
                      }`}
                    >
                      <SlidersHorizontal className="size-3" />
                      {t('clipInspector.exactControls')}
                    </Action>
                  </div>

                  {selectedClip.sourceType === 'caption' ? (
                    <div className="space-y-3 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3.5">
                      <label className="block">
                        <span className="mb-2 block text-[10px] font-[520] text-[var(--vh-text-2)]">
                          {t('captions.text')}
                        </span>
                        <textarea
                          value={selectedClip.text ?? ''}
                          rows={4}
                          onChange={(event) => {
                            const text = event.target.value;
                            commitDocument((current) =>
                              applyEditorOperations(
                                current,
                                text.trim()
                                  ? [
                                      {
                                        type: 'upsert_caption',
                                        clipId: selectedClip.id,
                                        text,
                                        startTime: selectedClip.startTime,
                                        duration: selectedClip.duration,
                                      },
                                    ]
                                  : [
                                      {
                                        type: 'remove_clip',
                                        clipId: selectedClip.id,
                                      },
                                    ]
                              ).document
                            );
                            if (!text.trim()) setSelectedClipId(null);
                          }}
                          className="w-full resize-none rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-3 py-2 text-[12px] text-[var(--vh-text-1)] outline-none focus:border-[var(--vh-border)]"
                        />
                      </label>
                      <div>
                        <span className="mb-2 block text-[10px] font-[520] text-[var(--vh-text-2)]">
                          {t('captions.style')}
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          {CAPTION_STYLE_PRESETS.map((preset) => (
                            <Action
                              key={preset}
                              type="button"
                              aria-pressed={document.captionStyle === preset}
                              onClick={() =>
                                commitDocument((current) =>
                                  applyEditorOperations(current, [
                                    { type: 'set_caption_style', preset },
                                  ]).document
                                )
                              }
                              className={`flex h-12 items-center justify-between rounded-lg border px-3 text-left transition ${
                                document.captionStyle === preset
                                  ? 'border-[var(--vh-graph)]/65 bg-[var(--vh-graph)]/10 text-[var(--vh-text-1)]'
                                  : 'border-[var(--vh-border)] bg-[var(--vh-control)] text-[var(--vh-text-2)] hover:border-[var(--vh-border)] hover:text-[var(--vh-text-1)]'
                              }`}
                            >
                              <span className="text-[10px] font-[560]">
                                {t(`captions.styles.${preset}`)}
                              </span>
                              <span
                                className={`grid h-7 min-w-8 place-items-center rounded px-1.5 text-[10px] ${
                                  preset === 'boxed' ? 'bg-[var(--vh-control)]' : ''
                                }`}
                                style={{
                                  fontWeight: getCaptionStyleDefinition(preset).fontWeight,
                                  textTransform:
                                    getCaptionStyleDefinition(preset).uppercase
                                      ? 'uppercase'
                                      : 'none',
                                  WebkitTextStroke:
                                    getCaptionStyleDefinition(preset).strokeStyle
                                      ? '0.6px rgba(0,0,0,0.85)'
                                      : undefined,
                                }}
                              >
                                Aa
                              </span>
                            </Action>
                          ))}
                        </div>
                      </div>
                      {selectedCaptionStyle ? (
                        <div className="space-y-3 border-t border-[var(--vh-border)] pt-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[10px] font-[560] text-[var(--vh-text-2)]">
                              {t('captions.currentCue')}
                            </span>
                            <span className="text-[9px] text-[var(--vh-text-2)]">
                              {t('captions.currentCueHint')}
                            </span>
                          </div>
                          {([
                            [
                              'fontScale',
                              0.015,
                              0.12,
                              0.001,
                              selectedCaptionStyle.fontScale,
                            ],
                            [
                              'maxWidth',
                              0.25,
                              0.98,
                              0.01,
                              selectedCaptionStyle.maxWidth,
                            ],
                            [
                              'bottomOffset',
                              0.02,
                              0.9,
                              0.01,
                              selectedCaptionStyle.bottomOffset,
                            ],
                          ] as const).map(([field, min, max, step, value]) => (
                            <label key={field} className="block">
                              <span className="mb-2 flex items-center justify-between text-[10px] font-[520] text-[var(--vh-text-2)]">
                                <span>{t(`captions.${field}`)}</span>
                                <span className="tabular-nums text-[var(--vh-text-2)]">
                                  {field === 'fontScale'
                                    ? `${(value * 100).toFixed(1)}%`
                                    : `${Math.round(value * 100)}%`}
                                </span>
                              </span>
                              <input
                                type="range"
                                min={min}
                                max={max}
                                step={step}
                                value={value}
                                onChange={(event) =>
                                  commitDocument((current) =>
                                    applyEditorOperations(current, [
                                      {
                                        type: 'update_caption',
                                        clipId: selectedClip.id,
                                        patch: {
                                          [field]: Number(event.target.value),
                                        },
                                      },
                                    ]).document
                                  )
                                }
                                className="h-1 w-full accent-[var(--vh-graph)]"
                              />
                            </label>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : selectedIsOverlay && selectedClip.overlay ? (
                    <div className="space-y-4 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3.5">
                      <OverlayInspector locked={document.tracks.some(track => track.id === selectedClip.trackId && track.locked)} clip={selectedClip} time={timelineCurrentTime} onSeek={seekTimeline}
                        onEdit={operation => commitDocument(current => applyEditorOperations(current, [operation]).document)} />
                      <div className="grid grid-cols-2 gap-2 border-t border-[var(--vh-border)] pt-3">
                        <label className="block">
                          <span className="mb-2 block text-[10px] text-[var(--vh-text-2)]">
                            {t('clipInspector.timelinePosition')}
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={Number(selectedClip.startTime.toFixed(2))}
                            onChange={(event) =>
                              moveSelectedClip(Number(event.target.value))
                            }
                            className="h-8 w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 text-[11px] tabular-nums text-[var(--vh-text-1)] outline-none focus:border-[var(--vh-graph)]/55"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-[10px] text-[var(--vh-text-2)]">
                            {t('clipInspector.stillDuration')}
                          </span>
                          <input
                            type="number"
                            min={MIN_CLIP_DURATION}
                            step={0.1}
                            value={Number(selectedClip.duration.toFixed(2))}
                            onChange={(event) =>
                              resizeSelectedImage(Number(event.target.value))
                            }
                            className="h-8 w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 text-[11px] tabular-nums text-[var(--vh-text-1)] outline-none focus:border-[var(--vh-graph)]/55"
                          />
                        </label>
                      </div>
                    </div>
                  ) : selectedClip.sourceType === 'audio' ? (
                    <div className="space-y-4 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3.5">
                      {([
                        ['volume', 0, 1, 0.01, selectedClip.volume],
                        ['fadeIn', 0, selectedClip.duration, 0.01, selectedClip.fadeIn],
                        ['fadeOut', 0, selectedClip.duration, 0.01, selectedClip.fadeOut],
                      ] as const).map(([field, min, max, step, value]) => (
                        <label key={field} className="block">
                          <span className="mb-2 flex items-center justify-between text-[10px] font-[520] text-[var(--vh-text-2)]">
                            <span>{t(`audio.${field}`)}</span>
                            <span className="tabular-nums text-[var(--vh-text-2)]">
                              {field === 'volume'
                                ? `${Math.round(Math.min(1, value) * 100)}%`
                                : `${value.toFixed(2)}s`}
                            </span>
                          </span>
                          <input
                            type="range"
                            min={min}
                            max={max}
                            step={step}
                            value={value}
                            onChange={(event) =>
                              commitDocument((current) =>
                                applyEditorOperations(current, [
                                  {
                                    type: 'update_audio',
                                    clipId: selectedClip.id,
                                    patch: {
                                      [field]: Number(event.target.value),
                                    },
                                  },
                                ]).document
                              )
                            }
                            className="h-1 w-full accent-[var(--vh-graph)]"
                          />
                        </label>
                      ))}
                      <Action
                        type="button"
                        onClick={() =>
                          commitDocument((current) =>
                            applyEditorOperations(current, [
                              {
                                type: 'update_audio',
                                clipId: selectedClip.id,
                                patch: { muted: !selectedClip.muted },
                              },
                            ]).document
                          )
                        }
                        className={`inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border text-[11px] font-[550] transition ${
                          selectedClip.muted
                            ? 'border-red-400/25 bg-red-400/10 text-red-800'
                            : 'border-[var(--vh-border)] bg-[var(--vh-control)] text-[var(--vh-text-2)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]'
                        }`}
                      >
                        <Volume2 className="size-3.5" />
                        {selectedClip.muted ? t('audio.unmute') : t('audio.mute')}
                      </Action>
                      <p className="text-[10px] leading-4 text-[var(--vh-text-2)]">
                        {selectedClip.muted
                          ? t('audio.mutedHint')
                          : t('audio.activeHint')}
                      </p>
                    </div>
                  ) : exactControlsOpen ? (
                    <div className="space-y-3 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-3.5">
                      {selectedClip.sourceType === 'video' && !selectedClip.activeTakeId ? (
                        <label className="block">
                          <span className="mb-2 block text-[10px] text-[var(--vh-text-2)]">
                            {t('clipInspector.sourceRange')}
                          </span>
                          <span className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={selectedClip.outPoint - MIN_CLIP_DURATION}
                              step={0.01}
                              value={Number(selectedClip.inPoint.toFixed(2))}
                              onChange={(event) => updateTrim('in', Number(event.target.value))}
                              className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 text-[11px] tabular-nums text-[var(--vh-text-1)] outline-none focus:border-[var(--vh-accent)]/55"
                            />
                            <span className="text-[var(--vh-text-2)]">→</span>
                            <input
                              type="number"
                              min={selectedClip.inPoint + MIN_CLIP_DURATION}
                              max={selectedClip.sourceDuration}
                              step={0.01}
                              value={Number(selectedClip.outPoint.toFixed(2))}
                              onChange={(event) => updateTrim('out', Number(event.target.value))}
                              className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 text-[11px] tabular-nums text-[var(--vh-text-1)] outline-none focus:border-[var(--vh-accent)]/55"
                            />
                          </span>
                        </label>
                      ) : selectedClip.sourceType === 'image' ? (
                        <label className="block">
                          <span className="mb-2 block text-[10px] text-[var(--vh-text-2)]">
                            {t('clipInspector.stillDuration')}
                          </span>
                          <input
                            type="number"
                            min={MIN_CLIP_DURATION}
                            step={0.1}
                            value={Number(selectedClip.duration.toFixed(2))}
                            onChange={(event) => resizeSelectedImage(Number(event.target.value))}
                            className="h-8 w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 text-[11px] tabular-nums text-[var(--vh-text-1)] outline-none focus:border-[var(--vh-accent)]/55"
                          />
                        </label>
                      ) : null}
                      <label className="block">
                        <span className="mb-2 block text-[10px] text-[var(--vh-text-2)]">
                          {t('clipInspector.timelinePosition')}
                        </span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={Number(selectedClip.startTime.toFixed(2))}
                          onChange={(event) => moveSelectedClip(Number(event.target.value))}
                          className="h-8 w-full rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 text-[11px] tabular-nums text-[var(--vh-text-1)] outline-none focus:border-[var(--vh-accent)]/55"
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] px-3 py-3 text-[10px] leading-4 text-[var(--vh-text-2)]">
                      {t('panel.exactHint')}
                    </p>
                  )}
                </div>

                <div className="border-t border-[var(--vh-border)] pt-4">
                  <p className="mb-3 text-[10px] font-[600] uppercase tracking-[0.08em] text-[var(--vh-text-2)]">
                    {t('panel.quickActions')}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Action
                      type="button"
                      onClick={() => void createDerivedSelection()}
                      disabled={selectedClip.sourceType !== 'video' || isExporting}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] text-[11px] font-[540] text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:opacity-30"
                    >
                      <Scissors className="size-3.5" />
                      {t('actions.extract')}
                    </Action>
                    <Action
                      type="button"
                      onClick={() => setRedoOpen((current) => !current)}
                      disabled={selectedClip.sourceType !== 'video' || isRedoing}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--vh-border)] bg-[var(--vh-control)] text-[11px] font-[540] text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:opacity-30"
                    >
                      <Sparkles className="size-3.5" />
                      {t('actions.redo')}
                    </Action>
                    <Action
                      type="button"
                      onClick={() => deleteSelectedClip(false)}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--vh-border)] text-[11px] font-[540] text-[var(--vh-text-2)] transition hover:border-red-400/25 hover:bg-red-400/10 hover:text-red-800"
                    >
                      <Trash2 className="size-3.5" />
                      {t('timeline.delete')}
                    </Action>
                    <Action
                      type="button"
                      onClick={() => deleteSelectedClip(true)}
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--vh-border)] text-[11px] font-[540] text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]"
                    >
                      {t('timeline.rippleDelete')}
                    </Action>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col">
                <div className="rounded-2xl border border-[var(--vh-border)] bg-[var(--vh-control)] p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-[#8d83ff]/15 text-[#a79fff]">
                      <Sparkles className="size-4" />
                    </span>
                    <div>
                      <p className="text-sm font-[600] text-[var(--vh-text-1)]">
                        {t('panel.welcomeTitle')}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[var(--vh-text-2)]">
                        {t('panel.subtitle')}
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-[11px] leading-5 text-[var(--vh-text-2)]">
                    {t('panel.welcomeDescription')}
                  </p>
                </div>
                <div className="mt-5 space-y-3">
                  {(['studio', 'canvas', 'edit', 'assets'] as const).map((step, index) => (
                    <div key={step} className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-[var(--vh-border)] bg-[var(--vh-control)] text-[10px] font-[600] text-[var(--vh-text-2)]">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-[11px] font-[570] text-[var(--vh-text-2)]">
                          {t(`panel.workflow.${step}.title`)}
                        </p>
                        <p className="mt-1 text-[10px] leading-4 text-[var(--vh-text-2)]">
                          {t(`panel.workflow.${step}.description`)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--vh-border)] p-4">
            <Action
              type="button"
              onClick={() => void addTimelineToCanvas()}
              disabled={clips.length === 0}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[var(--vh-border)] bg-[var(--vh-control)] text-xs font-[560] text-[var(--vh-text-2)] transition hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:opacity-30"
            >
              {t('actions.addTimelineToCanvas')}
            </Action>
          </div>
        </EditorInspectorPanel>
      </div>

      {error ? (
        <div className="absolute bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-xl border border-red-400/25 bg-red-950/90 px-4 py-3 text-xs text-red-800 shadow-lg backdrop-blur">
          {error}
        </div>
      ) : null}
    </div>
  );
}
