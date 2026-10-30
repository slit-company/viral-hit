import { m as uiMessages } from '@/paraglide/messages.js';
import { Action } from '@/components/base/action';
import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
} from '@xyflow/react';
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type VideoHTMLAttributes,
} from 'react';

import { enqueueMediaMetadataLoad } from '@/core/media/media-load-queue';
import { seekStaticVideoPreview } from '@/core/media/video-preview';
import { getCreativeCanvasNodeCopy } from './creative-canvas-node-copy';
import type { CreativeCanvasFlowNode } from '../react-flow/creative-canvas-react-flow-types';

function QueuedVideo({
  src,
  ...props
}: VideoHTMLAttributes<HTMLVideoElement> & { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    return enqueueMediaMetadataLoad(video, src);
  }, [src]);
  return <video ref={videoRef} {...props} />;
}

const CARD_RADIUS = 8;

export function AssetCardNode({
  id,
  data,
  selected,
}: NodeProps<CreativeCanvasFlowNode>) {
  const props = data.props;
  if (!('thumbnailUrl' in props)) return null;

  const {
    w,
    h,
    cardMediaType,
    title,
    thumbnailUrl,
    fitMode,
    chromeMode,
    durationSec,
    audioRole,
    clipCount,
  } = props;
  const shapeCopy = getCreativeCanvasNodeCopy();
  const isContain = fitMode === 'contain';
  const isFrameless = chromeMode === 'frameless';
  const hasOuterChrome = !isFrameless;
  const [mediaStatus, setMediaStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >(thumbnailUrl ? 'loading' : 'idle');

  useEffect(() => {
    setMediaStatus(thumbnailUrl ? 'loading' : 'idle');
  }, [cardMediaType, thumbnailUrl]);
  const canPreviewMedia =
    Boolean(thumbnailUrl) &&
    (cardMediaType === 'video' ||
      (cardMediaType === 'image' &&
        !thumbnailUrl.startsWith('data:image/svg+xml')));

  const handlePreviewMedia = (event: MouseEvent<HTMLElement>) => {
    if (!canPreviewMedia || typeof window === 'undefined') return;
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(
      new CustomEvent('creative-canvas:preview-media', {
        detail: {
          type: cardMediaType,
          url: thumbnailUrl,
          title:
            title ||
            (cardMediaType === 'video' ? shapeCopy.video : shapeCopy.image),
        },
      })
    );
  };

  const openTimelineEditor = (event: MouseEvent<HTMLElement>) => {
    if (cardMediaType !== 'timeline' || typeof window === 'undefined') return;
    event.preventDefault();
    event.stopPropagation();
    const nextPath = window.location.pathname.replace('/canvas/', '/editor/');
    window.location.assign(nextPath || window.location.pathname);
  };

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={48}
        minHeight={48}
        lineClassName="!border-[var(--vh-graph)]"
        handleClassName="!size-2.5 !border-[var(--vh-graph)] !bg-[var(--vh-surface)]"
      />
      <Handle
        type="target"
        position={Position.Left}
        className="!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0"
      />
      <div
        data-card-id={id}
        className="group cursor-grab active:cursor-grabbing"
        style={{
          width: w,
          height: h,
          borderRadius: CARD_RADIUS,
          background: hasOuterChrome
            ? 'var(--vh-surface)'
            : 'transparent',
          border: selected
            ? '2px solid var(--vh-graph)'
            : hasOuterChrome
              ? '1px solid var(--vh-border)'
              : '1px solid transparent',
          boxShadow: selected
            ? '0 0 0 3px rgba(127,176,242,0.18)'
            : hasOuterChrome && thumbnailUrl
              ? 'var(--shadow-float)'
              : 'none',
          overflow: 'hidden',
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {!thumbnailUrl && cardMediaType !== 'audio' && cardMediaType !== 'timeline' && (
          <div
            style={{
              position: 'absolute',
              top: 5,
              left: 5,
              zIndex: 3,
              fontSize: 9,
              fontWeight: 500,
              color: 'var(--vh-text-3)',
              padding: '1px 6px',
              borderRadius: 3,
              lineHeight: '14px',
            }}
          >
            {title ||
              (cardMediaType === 'video' ? shapeCopy.video : shapeCopy.image)}
          </div>
        )}
        {cardMediaType === 'audio' ? (
          <div className="flex size-full flex-col justify-between px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[12px] font-semibold text-[var(--vh-text-1)]">{title}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--vh-text-2)]">
                  {audioRole?.replace('_', ' ') || 'audio'}
                </p>
              </div>
              <span className="font-mono text-[10px] tabular-nums text-[var(--vh-text-2)]">
                {typeof durationSec === 'number' ? `${durationSec.toFixed(2)}s` : '—'}
              </span>
            </div>
            <div className="flex h-7 items-center gap-[3px]" aria-hidden="true">
              {Array.from({ length: 28 }, (_, index) => (
                <span
                  key={index}
                  className="w-[2px] flex-1 rounded-full bg-[var(--vh-graph)]/70"
                  style={{ height: `${22 + ((index * 37) % 72)}%` }}
                />
              ))}
            </div>
            {thumbnailUrl ? (
              <audio
                src={thumbnailUrl}
                controls
                preload="metadata"
                className="nodrag nopan nowheel h-7 w-full opacity-80"
                onLoadedMetadata={() => setMediaStatus('ready')}
                onError={() => setMediaStatus('error')}
                onPointerDown={(event) => event.stopPropagation()}
              />
            ) : null}
          </div>
        ) : cardMediaType === 'timeline' ? (
          <Action
            type="button"
            onClick={openTimelineEditor}
            onDoubleClick={openTimelineEditor}
            className="nodrag nopan flex size-full flex-col text-left"
          >
            <div className="relative flex-1 overflow-hidden bg-[var(--vh-control)]">
              {thumbnailUrl ? (
                <QueuedVideo
                  src={thumbnailUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="size-full object-cover opacity-70"
                  onLoadedMetadata={() => setMediaStatus('ready')}
                  onError={() => setMediaStatus('error')}
                />
              ) : (
                <div className="grid size-full place-items-center text-[11px] uppercase tracking-[0.18em] text-[var(--vh-text-2)]"> {uiMessages["ui.creative-canvas.timeline"]()} </div>
              )}
              <span className="absolute left-3 top-3 rounded-md border border-[var(--vh-border)] bg-[var(--vh-control)] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--vh-text-2)]"> {uiMessages["ui.creative-canvas.timeline"]()} </span>
            </div>
            <div className="border-t border-[var(--vh-border)] px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[12px] font-semibold text-[var(--vh-text-1)]">{title}</p>
                <span className="font-mono text-[10px] tabular-nums text-[var(--vh-text-2)]">
                  {typeof durationSec === 'number' ? `${durationSec.toFixed(1)}s` : '0.0s'}
                </span>
              </div>
              <div className="mt-2 flex h-2 gap-1 rounded-sm bg-[var(--vh-control)] p-px">
                {Array.from({ length: Math.max(1, Math.min(8, clipCount ?? 1)) }, (_, index) => (
                  <span key={index} className="flex-1 rounded-[2px] bg-[var(--vh-graph)]/55" />
                ))}
              </div>
            </div>
          </Action>
        ) : thumbnailUrl && mediaStatus === 'error' ? (
          <div
            className="grid size-full place-items-center px-4 text-center text-xs text-[var(--vh-text-3)]"
            role="status"
          >
            {shapeCopy.previewUnavailable}
          </div>
        ) : thumbnailUrl && cardMediaType === 'video' ? (
          <>
            <QueuedVideo
              src={thumbnailUrl}
              aria-label={title}
              muted
              playsInline
              preload="metadata"
              draggable={false}
              onLoadedMetadata={(event) => {
                seekStaticVideoPreview(event.currentTarget);
              }}
              onLoadedData={() => setMediaStatus('ready')}
              onError={() => setMediaStatus('error')}
              onDoubleClick={handlePreviewMedia}
              className="nowheel"
              style={{
                width: '100%',
                height: '100%',
                objectFit: isContain ? 'contain' : 'cover',
                display: 'block',
                cursor: 'zoom-in',
                borderRadius: CARD_RADIUS - 1,
                padding: 0,
                boxSizing: 'border-box',
              }}
            />
            {mediaStatus === 'ready' ? (
              <Action
                type="button"
                aria-label={`${shapeCopy.viewResult}: ${
                  title || shapeCopy.video
                }`}
                className="nodrag nopan nowheel absolute left-1/2 top-1/2 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--vh-border)] bg-[var(--vh-control)] text-lg text-[var(--vh-text-1)] opacity-80 shadow-lg transition-[opacity,transform,background-color] hover:scale-105 hover:bg-[var(--vh-control)] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vh-graph)] group-hover:opacity-100"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={handlePreviewMedia}
              >
                <span aria-hidden="true" className="ml-0.5">
                  ▶
                </span>
              </Action>
            ) : null}
          </>
        ) : thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={title}
            draggable={false}
            onLoad={() => setMediaStatus('ready')}
            onError={() => setMediaStatus('error')}
            onDoubleClick={handlePreviewMedia}
            className="nowheel"
            style={{
              width: '100%',
              height: '100%',
              objectFit: isContain ? 'contain' : 'cover',
              display: 'block',
              cursor: canPreviewMedia ? 'zoom-in' : 'default',
              borderRadius: CARD_RADIUS - 1,
              padding: 0,
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--vh-text-3)',
              fontSize: 13,
            }}
          >
            {cardMediaType === 'video'
              ? `▶ ${shapeCopy.video}`
              : `🖼 ${shapeCopy.image}`}
          </div>
        )}
        {thumbnailUrl && mediaStatus === 'loading' ? (
          <div
            className="pointer-events-none absolute inset-0 grid place-items-center bg-[var(--vh-control)] px-3 text-center text-[11px] text-[var(--vh-text-1)]"
            role="status"
          >
            {shapeCopy.previewLoading}
          </div>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!pointer-events-none !h-px !w-px !border-0 !bg-transparent !opacity-0"
      />
    </>
  );
}
