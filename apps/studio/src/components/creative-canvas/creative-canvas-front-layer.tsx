import { resolveAnalysisInputs } from '@/core/generation-providers/analysis-inputs';
import { composerReferenceOptions } from './composer-reference-options';
import { AnalysisSources } from './analysis-sources';
import { useAvailableModels } from '@/core/workspace-hooks/use-available-models';
import { ModelOptions } from '@/components/generation-providers/model-options';
import { Action } from '@/components/base/action';
import {
  countPromptCharacters,
  getGenerationPromptConstraints,
  getGenerationPromptMaxChars,
  truncatePromptToMaxChars,
} from '@/core/effects/validation';
import { VIDEO_ANALYSIS_MODEL_ID } from '@/core/effects/video-analysis';
import {
  findWorkspaceModelOption,
  getWorkspaceAspectRatioOptions,
} from '@/core/effects/workspace-models';
import { cn } from '@/lib/utils';
import { StudioStartHere } from '@/components/studio/studio-start-here';
import {
  getDraftReferencePickerOptions,
  isDraftBusyStatus,
  listCompatibleCanvasReferenceCards,
  resolveReferenceDrivenDraftAspectRatio,
} from '@/core/creative-canvas/composer';

import {
  listGenerationOutputsForDraft,
  resolvePinnedGenerationOutputId,
} from '@/core/creative-canvas/generation-history';
import {
  EyeOff,
  Focus,
  Hand,
  Magnet,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Undo2,
} from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useCanvasEngine,
  useCanvasEngineValue,
} from './canvas-engine/canvas-engine-context';
import { CreativeCanvasComposerModelPicker } from './creative-canvas-composer-model-picker';
import { CreativeCanvasAnalysisDepthPicker } from './creative-canvas-analysis-depth-picker';
import { CreativeCanvasComposerParameterPicker } from './creative-canvas-composer-parameter-picker';
import { CreativeCanvasComposerReferencePicker } from './creative-canvas-composer-reference-picker';
import { CreativeCanvasComposerShell } from './creative-canvas-composer-shell';
import { CreativeCanvasComposerTypePicker } from './creative-canvas-composer-type-picker';
import { CreativeCanvasComposerVersionPicker } from './creative-canvas-composer-version-picker';
import {
  isDraftCard,
  normalizeComposerToken,
  resolveAnchoredComposerPosition,
} from './creative-canvas-composer-utils';
import { useCanvasFrontLayer } from './creative-canvas-front-layer-context';
import { useComposerPopovers } from './use-composer-popovers';
import { CreativeCanvasComposerShotPicker } from './creative-canvas-composer-shot-picker';
import { CardConnectorOverlay } from './creative-canvas-card-connector-overlay';
import { creativeCanvasPanelClassName } from './creative-canvas-theme';
import { registerGenerationCardHoverCallback } from './creative-canvas-generation-hover-bridge';

export type { CreativeCanvasFrontLayerValue } from './creative-canvas-front-layer-context';

const VIRAL_HIT_ZOOM_STEPS = [
  0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.4, 2.8, 3.2, 3.6, 4,
];

const COMPOSER_HOVER_OPEN_DELAY_MS = 140;
const COMPOSER_HOVER_CLOSE_DELAY_MS = 220;

function areZoomStepsEqual(current: number[] | undefined, next: number[]) {
  return (
    Array.isArray(current) &&
    current.length === next.length &&
    current.every((step, index) => step === next[index])
  );
}

export function CreativeCanvasFrontLayer() {
  const { editor } = useCanvasEngine();
  const { analysisModels } = useAvailableModels();
  const {
    cards,
    composerPresentation,
    effectMetadataMap,
    imageModels,
    labels,
    canUndoCanvas,
    canRedoCanvas,
    onUndoCanvas,
    onRedoCanvas,
    onActiveComposerCardIdChange,
    onSelectedShapeIdsChange,
    onDraftAnalysisDepthChange,
    onDraftModelOptionsChange,
    onDraftAspectRatioChange,
    onDraftBackgroundSourceChange,
    onDraftCharacterOrientationChange,
    onDraftDurationChange,
    onDraftLanguageChange,
    onDraftModeChange,
    onDraftModelChange,
    onDraftOutputQualityChange,
    onDraftPromptChange,
    onDraftQualityChange,
    onDraftTaskTypeChange,
    onDraftVariantChange,
    onOpenReferencePicker,
    onAttachCanvasReference,
    onDetachCanvasReference,
    onReorderCanvasReferences,
    onPinGenerationOutput,
    onGenerateDraft,
    onSelectedCanvasCardIdsChange,
    promptCharacterLimit,
    videoModels,
  } = useCanvasFrontLayer();
  const [promptInputValue, setPromptInputValue] = useState('');
  const [isPromptComposing, setIsPromptComposing] = useState(false);
  const [activeCanvasTool, setActiveCanvasTool] = useState<'select' | 'pan'>(
    'select'
  );
  const [edgesVisible, setEdgesVisible] = useState(true);
  const [isSnapToGridActive, setIsSnapToGridActive] = useState(false);
  const [hoveredComposerCardId, setHoveredComposerCardId] = useState<
    string | null
  >(null);
  const [composerHeight, setComposerHeight] = useState(260);
  const composerRef = useRef<HTMLElement | null>(null);
  const hoveredComposerCardIdRef = useRef<string | null>(null);
  const composerOpenTimerRef = useRef<number | null>(null);
  const composerCloseTimerRef = useRef<number | null>(null);
  const isPointerWithinComposerRef = useRef(false);
  const isFocusWithinComposerRef = useRef(false);

  const selectedShapeIds = useCanvasEngineValue(
    (currentEditor) => currentEditor.getSelectedShapeIds(),
    [cards]
  );
  const selectedCardIds = useMemo(
    () => selectedShapeIds.filter((shapeId) => Boolean(cards[shapeId])),
    [cards, selectedShapeIds]
  );
  const selectedCardIdsKey = selectedCardIds.join(',');
  const zoomLevel = useCanvasEngineValue(
    (currentEditor) =>
      Math.round(
        ((typeof currentEditor.getZoomLevel === 'function'
          ? currentEditor.getZoomLevel()
          : 1) || 1) * 100
      )
  );
  const camera = useCanvasEngineValue((currentEditor) =>
    currentEditor.getCamera()
  );
  const frameToViewportRect = useMemo(
    () => (frame: { x: number; y: number; w: number; h: number }) => {
      const topLeft = editor.pageToViewport({ x: frame.x, y: frame.y });
      const bottomRight = editor.pageToViewport({
        x: frame.x + frame.w,
        y: frame.y + frame.h,
      });

      return {
        left: topLeft.x,
        top: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      };
    },
    [editor]
  );

  useEffect(() => {
    onSelectedShapeIdsChange(selectedShapeIds);
  }, [onSelectedShapeIdsChange, selectedShapeIds]);

  useEffect(() => {
    onSelectedCanvasCardIdsChange(selectedCardIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire when the actual card IDs change, not on every cards object update
  }, [onSelectedCanvasCardIdsChange, selectedCardIdsKey]);

  useEffect(() => {
    if (
      typeof editor.getCameraOptions !== 'function' ||
      typeof editor.setCameraOptions !== 'function'
    ) {
      return;
    }

    const cameraOptions = editor.getCameraOptions();

    if (areZoomStepsEqual(cameraOptions.zoomSteps, VIRAL_HIT_ZOOM_STEPS)) {
      return;
    }

    editor.setCameraOptions({
      ...cameraOptions,
      zoomSteps: VIRAL_HIT_ZOOM_STEPS,
    });
  }, [editor]);

  const clearComposerOpenTimer = useCallback(() => {
    if (composerOpenTimerRef.current === null) return;
    window.clearTimeout(composerOpenTimerRef.current);
    composerOpenTimerRef.current = null;
  }, []);

  const clearComposerCloseTimer = useCallback(() => {
    if (composerCloseTimerRef.current === null) return;
    window.clearTimeout(composerCloseTimerRef.current);
    composerCloseTimerRef.current = null;
  }, []);

  const closeHoveredComposer = useCallback(() => {
    clearComposerOpenTimer();
    clearComposerCloseTimer();
    hoveredComposerCardIdRef.current = null;
    isPointerWithinComposerRef.current = false;
    isFocusWithinComposerRef.current = false;
    setHoveredComposerCardId(null);
    onActiveComposerCardIdChange(null);
  }, [
    clearComposerCloseTimer,
    clearComposerOpenTimer,
    onActiveComposerCardIdChange,
  ]);

  const scheduleComposerClose = useCallback(
    (cardId?: string) => {
      clearComposerCloseTimer();
      composerCloseTimerRef.current = window.setTimeout(() => {
        composerCloseTimerRef.current = null;
        if (
          isPointerWithinComposerRef.current ||
          isFocusWithinComposerRef.current ||
          (cardId && hoveredComposerCardIdRef.current !== cardId)
        ) {
          return;
        }
        closeHoveredComposer();
      }, COMPOSER_HOVER_CLOSE_DELAY_MS);
    },
    [clearComposerCloseTimer, closeHoveredComposer]
  );

  useEffect(() => {
    registerGenerationCardHoverCallback((cardId, isPointerWithinCard) => {
      clearComposerOpenTimer();

      if (!isPointerWithinCard) {
        scheduleComposerClose(cardId);
        return;
      }

      clearComposerCloseTimer();
      const card = cards[cardId];
      if (!isDraftCard(card)) return;

      if (hoveredComposerCardIdRef.current === cardId) {
        return;
      }

      composerOpenTimerRef.current = window.setTimeout(() => {
        composerOpenTimerRef.current = null;
        hoveredComposerCardIdRef.current = cardId;
        setHoveredComposerCardId(cardId);
        onActiveComposerCardIdChange(cardId);
      }, COMPOSER_HOVER_OPEN_DELAY_MS);
    });

    return () => {
      registerGenerationCardHoverCallback(null);
      clearComposerOpenTimer();
      clearComposerCloseTimer();
    };
  }, [
    cards,
    clearComposerCloseTimer,
    clearComposerOpenTimer,
    onActiveComposerCardIdChange,
    scheduleComposerClose,
  ]);

  const handleComposerPointerChange = useCallback(
    (isPointerWithinComposer: boolean) => {
      isPointerWithinComposerRef.current = isPointerWithinComposer;
      if (isPointerWithinComposer) {
        clearComposerCloseTimer();
        return;
      }
      scheduleComposerClose();
    },
    [clearComposerCloseTimer, scheduleComposerClose]
  );

  const handleComposerFocusChange = useCallback(
    (isFocusWithinComposer: boolean) => {
      isFocusWithinComposerRef.current = isFocusWithinComposer;
      if (isFocusWithinComposer) {
        clearComposerCloseTimer();
        return;
      }
      scheduleComposerClose();
    },
    [clearComposerCloseTimer, scheduleComposerClose]
  );

  const activeDraftCard = useMemo(() => {
    const activeCard = hoveredComposerCardId
      ? cards[hoveredComposerCardId]
      : null;
    return isDraftCard(activeCard) ? activeCard : null;
  }, [cards, hoveredComposerCardId]);
  const activeDraftFrame = useCanvasEngineValue(
    (currentEditor) => {
      if (!activeDraftCard) return null;

      const bounds = currentEditor.getShapePageBounds(
        activeDraftCard.id
      );
      return bounds
        ? { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }
        : null;
    },
    [
      activeDraftCard?.id,
      activeDraftCard?.type,
      activeDraftCard?.aspectRatio,
    ]
  );
  const canvasViewportWidth = useCanvasEngineValue(
    (currentEditor) => {
      try {
        return currentEditor.getContainer().clientWidth;
      } catch {
        return 0;
      }
    }
  );
  const canvasViewportHeight = useCanvasEngineValue(
    (currentEditor) => {
      try {
        return currentEditor.getContainer().clientHeight;
      } catch {
        return 0;
      }
    }
  );
  const activeDraftComposerPosition = useMemo(() => {
    if (
      !activeDraftFrame ||
      canvasViewportWidth <= 0 ||
      canvasViewportHeight <= 0
    ) {
      return null;
    }

    return resolveAnchoredComposerPosition({
      frame: frameToViewportRect(activeDraftFrame),
      viewportWidth: canvasViewportWidth,
      viewportHeight: canvasViewportHeight,
      composerHeight,
    });
  }, [
    activeDraftFrame,
    camera,
    canvasViewportHeight,
    canvasViewportWidth,
    composerHeight,
    frameToViewportRect,
  ]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!activeDraftCard || !composer) return;

    const updateComposerHeight = () => {
      setComposerHeight(composer.offsetHeight);
    };
    updateComposerHeight();

    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [activeDraftCard?.id]);

  const isAnalysisDraft = activeDraftCard?.generationMode === 'analysis';
  const modelOptions = isAnalysisDraft
    ? analysisModels
    : activeDraftCard?.type === 'image'
      ? imageModels
      : videoModels;
  const selectedModel =
    findWorkspaceModelOption(modelOptions, activeDraftCard?.modelId) ??
    (isAnalysisDraft ? null : modelOptions[0]) ??
    null;
  const selectedModelLabel = selectedModel?.name ?? labels.modelLabel;
  const selectedModeOptions = selectedModel?.modeOptions ?? [];
  const selectedVariantOptions = selectedModel?.variantOptions ?? [];
  const selectedQualityOptions = selectedModel?.qualityOptions ?? [];
  const selectedDurationOptions =
    activeDraftCard?.type === 'video'
      ? (selectedModel?.supportedDurations ?? [])
      : [];
  const selectedLanguageOptions = selectedModel?.supportedLanguages ?? [];
  const hasImageReferences =
    activeDraftCard?.referenceCardIds.some(
      (cardId) => cards[cardId]?.type === 'image'
    ) ?? false;
  const selectedAspectRatioOptions = useMemo(
    () =>
      getWorkspaceAspectRatioOptions({
        model: selectedModel,
        hasImageReferences,
      }),
    [hasImageReferences, selectedModel]
  );
  const selectedOutputQualities = selectedModel?.supportedOutputQualities ?? [];
  const selectedCharacterOrientationOptions =
    selectedModel?.characterOrientationOptions ?? [];
  const selectedBackgroundSourceOptions =
    selectedModel?.backgroundSourceOptions ?? [];
  const isDraftBusy = activeDraftCard
    ? isDraftBusyStatus(activeDraftCard.status)
    : false;
  const popovers = useComposerPopovers({ draftId: activeDraftCard?.id, isBusy: isDraftBusy });

  useEffect(() => {
    if (!activeDraftCard || !selectedModel || isDraftBusy) {
      return;
    }

    if (
      selectedAspectRatioOptions.length > 0 &&
      !selectedAspectRatioOptions.includes(activeDraftCard.aspectRatio)
    ) {
      onDraftAspectRatioChange(
        activeDraftCard.id,
        selectedModel.defaultAspectRatio ?? selectedAspectRatioOptions[0]
      );
      return;
    }

    const nextAspectRatio = resolveReferenceDrivenDraftAspectRatio({
      draftCard: activeDraftCard,
      cards,
      model: selectedModel,
      getReferenceDimensions: (card) => {
        const bounds = editor.getShapePageBounds(card.id);
        return bounds
          ? { width: bounds.w, height: bounds.h }
          : null;
      },
    });

    if (nextAspectRatio !== activeDraftCard.aspectRatio) {
      onDraftAspectRatioChange(activeDraftCard.id, nextAspectRatio);
    }
  }, [
    activeDraftCard,
    cards,
    editor,
    isDraftBusy,
    onDraftAspectRatioChange,
    selectedAspectRatioOptions,
    selectedModel,
  ]);

  const promptCharacterCount = countPromptCharacters(promptInputValue);
  const activePromptPlaceholder = isAnalysisDraft
    ? selectedModel?.analysisInputs ? 'Describe what to review across the selected media.' : labels.analysisPromptPlaceholder
    : activeDraftCard?.type === 'video'
      ? labels.videoPromptPlaceholder
      : labels.imagePromptPlaceholder;
  const activePromptCharacterLimit = isAnalysisDraft
    ? getGenerationPromptMaxChars({ modelId: VIDEO_ANALYSIS_MODEL_ID })
    : getGenerationPromptConstraints({
        modelId: selectedModel?.id,
      }).maxChars ?? promptCharacterLimit;

  const parameterSummaryTokens = useMemo(() => {
    if (!activeDraftCard) {
      return [];
    }

    const tokens: string[] = [];

    if (selectedOutputQualities.length > 0) {
      tokens.push(activeDraftCard.outputQuality.toUpperCase());
    }
    if (selectedAspectRatioOptions.length > 0) {
      tokens.push(
        normalizeComposerToken(activeDraftCard.aspectRatio, labels)
      );
    }
    if (selectedDurationOptions.length > 0) {
      tokens.push(activeDraftCard.duration);
    }
    if (
      selectedCharacterOrientationOptions.length > 0 &&
      activeDraftCard.characterOrientation
    ) {
      tokens.push(
        normalizeComposerToken(activeDraftCard.characterOrientation, labels)
      );
    }
    if (
      selectedBackgroundSourceOptions.length > 0 &&
      activeDraftCard.backgroundSource
    ) {
      tokens.push(
        normalizeComposerToken(activeDraftCard.backgroundSource, labels)
      );
    }
    if (selectedLanguageOptions.length > 0 && activeDraftCard.language) {
      tokens.push(
        normalizeComposerToken(activeDraftCard.language, labels)
      );
    }
    if (selectedModeOptions.length > 1) {
      tokens.push(normalizeComposerToken(activeDraftCard.mode, labels));
    }
    if (selectedVariantOptions.length > 1) {
      tokens.push(
        normalizeComposerToken(activeDraftCard.variant, labels)
      );
    }
    if (selectedQualityOptions.length > 1) {
      tokens.push(
        normalizeComposerToken(activeDraftCard.quality, labels)
      );
    }

    return tokens;
  }, [
    labels,
    selectedAspectRatioOptions,
    selectedBackgroundSourceOptions,
    selectedCharacterOrientationOptions,
    selectedDurationOptions,
    selectedLanguageOptions,
    selectedModeOptions,
    selectedOutputQualities,
    selectedQualityOptions,
    selectedVariantOptions,
    activeDraftCard,
  ]);

  const hiddenParameterTokenCount = Math.max(
    parameterSummaryTokens.length - 3,
    0
  );
  const parameterSummaryLabel = useMemo(() => {
    if (parameterSummaryTokens.length === 0) {
      return labels.defaultSetupLabel;
    }

    const visibleTokens = parameterSummaryTokens.slice(0, 3);
    return `${visibleTokens.join(' · ')}${
      hiddenParameterTokenCount > 0 ? ` +${hiddenParameterTokenCount}` : ''
    }`;
  }, [
    hiddenParameterTokenCount,
    labels.defaultSetupLabel,
    parameterSummaryTokens,
  ]);
  const visibleParameterSummaryTokens = useMemo(
    () =>
      parameterSummaryTokens.length > 0
        ? parameterSummaryTokens.slice(0, 3)
        : [labels.defaultSetupLabel],
    [labels.defaultSetupLabel, parameterSummaryTokens]
  );

  const referencePickerOptions = useMemo(
    () =>
      activeDraftCard
        ? getDraftReferencePickerOptions({
            draftCard: activeDraftCard,
            cards,
            model: selectedModel,
          })
        : [],
    [cards, selectedModel, activeDraftCard]
  );
  const primaryReferenceIntent =
    referencePickerOptions[0]?.intent ??
    (isAnalysisDraft ? 'video' : activeDraftCard?.type) ??
    'image';
  const currentReferenceCards = useMemo(
    () => composerReferenceOptions(activeDraftCard, cards),
    [activeDraftCard, cards]
  );
  const promptReferences = useMemo(
    () =>
      currentReferenceCards.map((card) => ({
        cardId: card.id,
        type: card.type,
        index: Number.parseInt(card.alias.replace(/\D/g, ''), 10),
        alias: card.alias,
        name: card.name,
        thumbnailUrl: card.thumbnailUrl,
      })),
    [currentReferenceCards]
  );
  const canvasReferenceCards = useMemo(() => {
    if (!activeDraftCard) {
      return [];
    }

    return listCompatibleCanvasReferenceCards({
      draftCard: activeDraftCard,
      cards,
      model: selectedModel,
    }).map((card) => ({
      id: card.id,
      name: card.name,
      type: card.type,
      thumbnailUrl: card.url,
    }));
  }, [activeDraftCard, cards, selectedModel]);
  const generationOutputs = useMemo(
    () =>
      activeDraftCard
        ? listGenerationOutputsForDraft(cards, activeDraftCard.id)
        : [],
    [activeDraftCard, cards]
  );
  const pinnedOutputId = useMemo(
    () =>
      resolvePinnedGenerationOutputId({
        outputs: generationOutputs,
        pinnedOutputId: activeDraftCard?.pinnedOutputId,
      }),
    [activeDraftCard?.pinnedOutputId, generationOutputs]
  );

  const truncatePrompt = (value: string) =>
    truncatePromptToMaxChars(value, activePromptCharacterLimit);

  const handlePromptValueChange = (nextPrompt: string) => {
    if (!activeDraftCard || isDraftBusy) {
      return;
    }

    setPromptInputValue(nextPrompt);

    if (isPromptComposing) {
      return;
    }

    onDraftPromptChange(activeDraftCard.id, truncatePrompt(nextPrompt));
  };

  const handlePromptCommit = (nextPrompt: string) => {
    if (!activeDraftCard || isDraftBusy) {
      return;
    }

    const truncatedPrompt = truncatePrompt(nextPrompt);
    setPromptInputValue(truncatedPrompt);
    onDraftPromptChange(activeDraftCard.id, truncatedPrompt);
  };

  useEffect(() => {
    if (!activeDraftCard) {
      setPromptInputValue('');
      setIsPromptComposing(false);
      return;
    }

    if (isPromptComposing) {
      return;
    }

    setPromptInputValue(activeDraftCard.prompt);
  }, [isPromptComposing, activeDraftCard]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30"
    >
      {!activeDraftCard ? (
        <div
          className={cn(
            'pointer-events-auto absolute bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-1 rounded-[var(--vh-radius-sm)] px-1.5 py-1',
            creativeCanvasPanelClassName
          )}
        >
          <Action
            type="button"
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-xl transition duration-150',
              activeCanvasTool === 'select'
                ? 'bg-[var(--vh-control)] text-[var(--vh-text-1)] shadow-none'
                : 'text-[var(--vh-text-2)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]'
            )}
            onClick={() => {
              setActiveCanvasTool('select');
              editor.setCurrentTool('select');
            }}
            aria-label={labels.selectToolLabel}
            aria-pressed={activeCanvasTool === 'select'}
          >
            <MousePointer2 className="size-3.5" />
          </Action>
          <Action
            type="button"
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-xl transition duration-150',
              activeCanvasTool === 'pan'
                ? 'bg-[var(--vh-control)] text-[var(--vh-text-1)] shadow-none'
                : 'text-[var(--vh-text-2)] hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]'
            )}
            onClick={() => {
              setActiveCanvasTool('pan');
              editor.setCurrentTool('pan');
            }}
            aria-label={labels.panToolLabel}
            aria-pressed={activeCanvasTool === 'pan'}
          >
            <Hand className="size-3.5" />
          </Action>
          <div className="mx-1 h-5 w-px bg-[var(--vh-control)]" />
          <Action
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-xl text-[var(--vh-text-2)] transition duration-150 hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]"
            onClick={() => {
              if (typeof editor.zoomOut === 'function') {
                editor.zoomOut(undefined, { animation: { duration: 180 } });
              }
            }}
            aria-label={labels.zoomOutLabel}
          >
            <Minus className="size-3.5" />
          </Action>
          <Action
            type="button"
            className="inline-flex h-8 min-w-[54px] items-center justify-center rounded-xl bg-[var(--vh-control)] px-2 text-[12px] font-medium tabular-nums text-[var(--vh-text-2)] transition duration-150 hover:text-[var(--vh-text-1)]"
            onClick={() => {
              if (typeof editor.resetZoom === 'function') {
                editor.resetZoom(undefined, { animation: { duration: 180 } });
              }
            }}
          >
            {zoomLevel}%
          </Action>
          <Action
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-xl text-[var(--vh-text-2)] transition duration-150 hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]"
            onClick={() => {
              if (typeof editor.zoomIn === 'function') {
                editor.zoomIn(undefined, { animation: { duration: 180 } });
              }
            }}
            aria-label={labels.zoomInLabel}
          >
            <Plus className="size-3.5" />
          </Action>
          <Action
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-xl text-[var(--vh-text-2)] transition duration-150 hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]"
            onClick={() => editor.fitView({ animation: { duration: 220 } })}
            aria-label={labels.fitViewLabel}
          >
            <Focus className="size-3.5" />
          </Action>
          <Action
            type="button"
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-xl transition duration-150 hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]',
              edgesVisible
                ? 'text-[var(--vh-text-2)]'
                : 'bg-[var(--vh-graph-soft)] text-[var(--vh-graph)]'
            )}
            onClick={() => {
              const next = !edgesVisible;
              setEdgesVisible(next);
              editor.setEdgesVisible(next);
            }}
            aria-label={
              edgesVisible ? labels.hideEdgesLabel : labels.showEdgesLabel
            }
            aria-pressed={!edgesVisible}
          >
            <EyeOff className="size-3.5" />
          </Action>
          <Action
            type="button"
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-xl transition duration-150 hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)]',
              isSnapToGridActive
                ? 'bg-[var(--vh-graph-soft)] text-[var(--vh-graph)]'
                : 'text-[var(--vh-text-2)]'
            )}
            onClick={() => {
              const next = !isSnapToGridActive;
              setIsSnapToGridActive(next);
              editor.setSnapToGrid(next);
            }}
            aria-label={labels.snapToGridLabel}
            aria-pressed={isSnapToGridActive}
          >
            <Magnet className="size-3.5" />
          </Action>
          <div className="mx-1 h-5 w-px bg-[var(--vh-control)]" />
          <Action
            type="button"
            disabled={!canUndoCanvas}
            onClick={onUndoCanvas}
            className="inline-flex size-8 items-center justify-center rounded-xl text-[var(--vh-text-2)] transition duration-150 hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:pointer-events-none disabled:text-[var(--vh-text-2)]"
            aria-label={labels.undoLabel}
          >
            <Undo2 className="size-3.5" />
          </Action>
          <Action
            type="button"
            disabled={!canRedoCanvas}
            onClick={onRedoCanvas}
            className="inline-flex size-8 items-center justify-center rounded-xl text-[var(--vh-text-2)] transition duration-150 hover:bg-[var(--vh-control)] hover:text-[var(--vh-text-1)] disabled:pointer-events-none disabled:text-[var(--vh-text-2)]"
            aria-label={labels.redoLabel}
          >
            <Redo2 className="size-3.5" />
          </Action>
        </div>
      ) : null}

      {Object.keys(cards).length === 0 ? (
        <div className="absolute inset-x-0 top-[46%] z-10 flex -translate-y-1/2 justify-center px-6">
          <StudioStartHere />
        </div>
      ) : null}

      {activeDraftCard ? (
        <CreativeCanvasComposerShell
          activeDraftCard={activeDraftCard}
          composerRef={composerRef}
          isDraftBusy={isDraftBusy}
          isPromptComposing={isPromptComposing}
          labels={labels}
          onActiveComposerCardIdChange={closeHoveredComposer}
          onComposerFocusChange={handleComposerFocusChange}
          onComposerPointerChange={handleComposerPointerChange}
          onGenerateDraft={onGenerateDraft}
          onPromptChange={handlePromptValueChange}
          onPromptCommit={handlePromptCommit}
          onPromptCompositionChange={setIsPromptComposing}
          primaryButtonLabel={
            isAnalysisDraft
              ? isDraftBusy
                ? labels.analyzingLabel
                : labels.analyzeLabel
              : undefined
          }
          promptCharacterCount={promptCharacterCount}
          promptCharacterLimit={activePromptCharacterLimit}
          promptInputValue={promptInputValue}
          promptPlaceholder={activePromptPlaceholder}
          promptReferences={promptReferences}
          presentation={composerPresentation}
          position={activeDraftComposerPosition}
          takeCount={generationOutputs.length}
          promptAccessory={(insertReferenceMention) => (
            <>
              {onDraftModelOptionsChange && <ModelOptions modelId={activeDraftCard.modelId} value={activeDraftCard.modelOptions} disabled={isDraftBusy} onChange={value => onDraftModelOptionsChange(activeDraftCard.id, value)} />}
              {isAnalysisDraft && (selectedModel?.analysisInputs || activeDraftCard.referenceCardIds.length > 1 || activeDraftCard.referenceCardIds.some(id => cards[id]?.type !== 'video')) ? <AnalysisSources draft={activeDraftCard} cards={cards} inputs={resolveAnalysisInputs(selectedModel?.analysisInputs)} disabled={isDraftBusy} onAttach={onAttachCanvasReference} onDetach={onDetachCanvasReference} /> : <CreativeCanvasComposerReferencePicker
                activeDraftId={activeDraftCard.id}
                canvasReferenceCards={canvasReferenceCards}
                containerRef={popovers.refs.reference}
                currentReferenceCards={currentReferenceCards}
                isDraftBusy={isDraftBusy}
                isOpen={popovers.open === 'reference'}
                labels={labels}
                onAttachCanvasReference={onAttachCanvasReference}
                onOpenChange={popovers.onOpenChange('reference')}
                onOpenReferencePicker={onOpenReferencePicker}
                onInsertReferenceMention={insertReferenceMention}
                onReorderCanvasReferences={onReorderCanvasReferences}
                onRemoveCanvasReference={onDetachCanvasReference}
                options={referencePickerOptions}
                primaryIntent={primaryReferenceIntent}
                variant="row"
              />}
              {!isAnalysisDraft ? <CreativeCanvasComposerShotPicker containerRef={popovers.refs.shot} disabled={isDraftBusy} isOpen={popovers.open === 'shot'}
                mediaType={activeDraftCard.type} onOpenChange={popovers.onOpenChange('shot')} onPromptChange={handlePromptValueChange} prompt={promptInputValue} /> : null}
              <CreativeCanvasComposerVersionPicker
                activeDraftId={activeDraftCard.id}
                containerRef={popovers.refs.version}
                isDraftBusy={isDraftBusy}
                isOpen={popovers.open === 'version'}
                labels={labels}
                onOpenChange={popovers.onOpenChange('version')}
                onPinGenerationOutput={onPinGenerationOutput}
                outputs={generationOutputs}
                pinnedOutputId={pinnedOutputId}
              />
            </>
          )}
        >
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
            <CreativeCanvasComposerTypePicker
              activeDraftId={activeDraftCard.id}
              containerRef={popovers.refs.type}
              isDraftBusy={isDraftBusy}
              isOpen={popovers.open === 'type'}
              labels={labels}
              onDraftTaskTypeChange={onDraftTaskTypeChange}
              onOpenChange={popovers.onOpenChange('type')}
              selectedType={
                activeDraftCard.generationMode ?? activeDraftCard.type
              }
            />

            {isAnalysisDraft ? (
              <CreativeCanvasAnalysisDepthPicker selectedModelId={activeDraftCard.modelId} onModelChange={onDraftModelChange}
                activeDraftId={activeDraftCard.id}
                containerRef={popovers.refs.model}
                depth={activeDraftCard.analysisDepth ?? 'standard'}
                isDraftBusy={isDraftBusy}
                isOpen={popovers.open === 'model'}
                labels={labels}
                onDepthChange={onDraftAnalysisDepthChange}
                onOpenChange={popovers.onOpenChange('model')}
              />
            ) : (
              <CreativeCanvasComposerModelPicker
                activeDraftId={activeDraftCard.id}
                containerRef={popovers.refs.model}
                isDraftBusy={isDraftBusy}
                isOpen={popovers.open === 'model'}
                modelOptions={modelOptions}
                onDraftModelChange={onDraftModelChange}
                onOpenChange={popovers.onOpenChange('model')}
                selectedModelId={
                  selectedModel?.id ?? activeDraftCard.modelId
                }
                selectedModelLabel={selectedModelLabel}
              />
            )}

            {!isAnalysisDraft ? (
              <CreativeCanvasComposerParameterPicker
                activeDraftCard={activeDraftCard}
                containerRef={popovers.refs.parameter}
                isDraftBusy={isDraftBusy}
                isOpen={popovers.open === 'parameter'}
                labels={labels}
                onDraftAspectRatioChange={onDraftAspectRatioChange}
                onDraftBackgroundSourceChange={onDraftBackgroundSourceChange}
                onDraftCharacterOrientationChange={
                  onDraftCharacterOrientationChange
                }
                onDraftDurationChange={onDraftDurationChange}
                onDraftLanguageChange={onDraftLanguageChange}
                onDraftModeChange={onDraftModeChange}
                onDraftOutputQualityChange={onDraftOutputQualityChange}
                onDraftQualityChange={onDraftQualityChange}
                onDraftVariantChange={onDraftVariantChange}
                onOpenChange={popovers.onOpenChange('parameter')}
                parameterSummaryLabel={parameterSummaryLabel}
                selectedAspectRatioOptions={selectedAspectRatioOptions}
                selectedBackgroundSourceOptions={
                  selectedBackgroundSourceOptions
                }
                selectedCharacterOrientationOptions={
                  selectedCharacterOrientationOptions
                }
                selectedDurationOptions={selectedDurationOptions}
                selectedLanguageOptions={selectedLanguageOptions}
                selectedModeOptions={selectedModeOptions}
                selectedOutputQualities={selectedOutputQualities}
                selectedQualityOptions={selectedQualityOptions}
                selectedVariantOptions={selectedVariantOptions}
                visibleParameterSummaryTokens={visibleParameterSummaryTokens}
              />
            ) : null}
          </div>
        </CreativeCanvasComposerShell>
      ) : null}

      <CardConnectorOverlay />
    </div>
  );
}
