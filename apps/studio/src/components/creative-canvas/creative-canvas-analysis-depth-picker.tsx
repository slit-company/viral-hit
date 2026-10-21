import { useWorkspaceModels } from '@/core/workspace-hooks/use-workspace-metadata';
import { VIDEO_ANALYSIS_MODEL_ID } from '@/core/effects/video-analysis';
import { Action } from '@/components/base/action';
import { getModelIconPathByModelId } from '@/core/workspace-lib/model-icons';
import type { VideoAnalysisDepth } from '@/core/effects/video-analysis';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, ScanSearch } from 'lucide-react';
import type { RefObject } from 'react';

import {
  composerFieldButtonClassName,
  composerFieldSlotClassName,
  composerFloatingPanelClassName,
  getComposerOptionRowClassName,
  stopComposerEvent,
} from './creative-canvas-composer-utils';
import type { CanvasLabels } from './creative-canvas-front-layer-context';

const ANALYSIS_DEPTHS: VideoAnalysisDepth[] = ['standard', 'deep'];

export function CreativeCanvasAnalysisDepthPicker({
  activeDraftId,
  selectedModelId = VIDEO_ANALYSIS_MODEL_ID,
  onModelChange,
  containerRef,
  depth,
  isDraftBusy,
  isOpen,
  labels,
  onDepthChange,
  onOpenChange,
}: {
  activeDraftId: string;
  selectedModelId?: string | null;
  onModelChange: (draftId: string, modelId: string) => void;
  containerRef?: RefObject<HTMLDivElement | null>;
  depth: VideoAnalysisDepth;
  isDraftBusy: boolean;
  isOpen: boolean;
  labels: CanvasLabels;
  onDepthChange: (draftId: string, depth: VideoAnalysisDepth) => void;
  onOpenChange: (nextOpen: boolean) => void;
}) {
  const { data } = useWorkspaceModels();
  const installed = data?.models.filter(model => model.workspaceType === 'analysis' && model.id !== VIDEO_ANALYSIS_MODEL_ID) ?? [];
  const isBuiltin = !selectedModelId || selectedModelId === VIDEO_ANALYSIS_MODEL_ID;
  const label = !isBuiltin ? installed.find(model => model.id === selectedModelId)?.name ?? selectedModelId :
    depth === 'deep'
      ? labels.analysisProModelLabel
      : labels.analysisStandardModelLabel;
  const modelId =
    depth === 'deep' ? 'video-analysis-pro' : 'video-analysis-standard';
  const iconPath = isBuiltin ? getModelIconPathByModelId(modelId) : null;

  return (
    <div ref={containerRef} className={cn(composerFieldSlotClassName, 'min-w-0')}>
      <Action
        type="button"
        aria-label={labels.analysisModelLabel}
        aria-expanded={isOpen}
        disabled={isDraftBusy}
        onClick={() => onOpenChange(!isOpen)}
        onPointerDownCapture={stopComposerEvent}
        className={cn(composerFieldButtonClassName, 'w-fit max-w-full')}
      >
        {iconPath ? (
          <span className="grid size-4 shrink-0 place-items-center rounded-[5px] bg-[var(--vh-control)] ring-1 ring-black/10">
            <img src={iconPath} alt="" className="max-h-3 max-w-3 object-contain" />
          </span>
        ) : (
          <ScanSearch className="size-3.5 shrink-0 text-[var(--vh-graph)]" />
        )}
        <span className="line-clamp-1 text-[12px] font-semibold text-[var(--vh-text-1)]">
          {label}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-[var(--vh-text-2)] transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </Action>

      {isOpen ? (
        <div
          className={cn(
            composerFloatingPanelClassName,
            'left-0 w-[min(300px,calc(100vw-48px))] max-sm:left-auto max-sm:right-0'
          )}
          onPointerDownCapture={stopComposerEvent}
        >
          <div className="max-h-[min(360px,50vh)] space-y-1 overflow-y-auto">
            {ANALYSIS_DEPTHS.map((option) => {
              const isSelected = isBuiltin && option === depth;
              const optionLabel =
                option === 'deep'
                  ? labels.analysisProModelLabel
                  : labels.analysisStandardModelLabel;
              const optionIcon = getModelIconPathByModelId(
                option === 'deep'
                  ? 'video-analysis-pro'
                  : 'video-analysis-standard'
              );

              return (
                <Action
                  key={option}
                  type="button"
                  disabled={isDraftBusy}
                  onClick={() => {
                    onModelChange(activeDraftId, VIDEO_ANALYSIS_MODEL_ID);
                    if (!isSelected) onDepthChange(activeDraftId, option);
                    onOpenChange(false);
                  }}
                  className={getComposerOptionRowClassName(isSelected)}
                >
                  {optionIcon ? (
                    <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-[var(--vh-control)] ring-1 ring-black/10">
                      <img src={optionIcon} alt="" className="max-h-3.5 max-w-3.5 object-contain" />
                    </span>
                  ) : (
                    <ScanSearch className="size-3.5 shrink-0 text-[var(--vh-text-2)]" />
                  )}
                  <span className="flex-1 text-left text-[12px] font-medium text-[var(--vh-text-1)]">
                    {optionLabel}
                  </span>
                  {isSelected ? (
                    <Check className="size-3.5 shrink-0 text-[var(--vh-accent)]" />
                  ) : null}
                </Action>
              );
            })}
            {installed.map(model => (
              <Action key={model.id} type="button" disabled={isDraftBusy || model.available === false}
                onClick={() => { onModelChange(activeDraftId, model.id); onOpenChange(false); }}
                className={getComposerOptionRowClassName(model.id === selectedModelId)}>
                <ScanSearch className="size-3.5 shrink-0" />
                <span className="flex-1 text-left text-[12px] font-medium break-words">{model.name}</span>
                {model.id === selectedModelId ? <Check className="size-3.5 shrink-0 text-[var(--vh-accent)]" /> : null}
              </Action>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
