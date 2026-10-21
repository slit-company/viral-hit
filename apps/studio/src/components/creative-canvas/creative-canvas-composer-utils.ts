import {
  composerFieldButtonClassName,
  composerFloatingPanelClassName,
  composerSectionLabelClassName,
  getComposerOptionRowClassName,
  getComposerParameterChipClassName,
} from '@/components/app/composer-styles';
import type {
  CanvasCard,
  CanvasGenerationCard,
} from '@/core/creative-canvas/canvas-types';
import type { CanvasLabels } from './creative-canvas-front-layer-context';

export const compactParameterGroupClass = 'flex flex-wrap gap-1.5';

export const composerFieldSlotClassName =
  'relative w-auto min-w-0 flex-none';

// Shared Cloud API composer vocabulary — see @/components/app/composer-styles.
export {
  composerFieldButtonClassName,
  composerFloatingPanelClassName,
  composerSectionLabelClassName,
  getComposerOptionRowClassName,
};

export const getParameterChipClassName = getComposerParameterChipClassName;

export const normalizeComposerToken = (
  value: string,
  labels?: Pick<
    CanvasLabels,
    | 'tokenQualityLabel'
    | 'tokenFastLabel'
    | 'tokenLiteLabel'
    | 'tokenLowLabel'
    | 'tokenMediumLabel'
    | 'tokenStandardLabel'
    | 'tokenHighLabel'
    | 'tokenProLabel'
    | 'tokenAdaptiveLabel'
    | 'tokenAutoLabel'
    | 'tokenLandscapeLabel'
    | 'tokenPortraitLabel'
    | 'tokenChineseLabel'
    | 'tokenEnglishLabel'
    | 'tokenImageOrientationLabel'
    | 'tokenVideoOrientationLabel'
    | 'tokenInputImageLabel'
    | 'tokenInputVideoLabel'
  >
) => {
  switch (value) {
    case 'quality':
      return labels?.tokenQualityLabel ?? 'Quality';
    case 'fast':
      return labels?.tokenFastLabel ?? 'Fast';
    case 'lite':
      return labels?.tokenLiteLabel ?? 'Lite';
    case 'low':
      return labels?.tokenLowLabel ?? 'Low';
    case 'medium':
      return labels?.tokenMediumLabel ?? 'Medium';
    case 'standard':
      return labels?.tokenStandardLabel ?? 'Standard';
    case 'high':
      return labels?.tokenHighLabel ?? 'High';
    case 'pro':
      return labels?.tokenProLabel ?? 'Pro';
    case 'adaptive':
      return labels?.tokenAdaptiveLabel ?? 'Adaptive';
    case 'auto':
      return labels?.tokenAutoLabel ?? 'Auto';
    case 'landscape':
      return labels?.tokenLandscapeLabel ?? 'Landscape';
    case 'portrait':
      return labels?.tokenPortraitLabel ?? 'Portrait';
    case 'zh':
      return labels?.tokenChineseLabel ?? 'Chinese';
    case 'en':
      return labels?.tokenEnglishLabel ?? 'English';
    case 'image':
      return labels?.tokenImageOrientationLabel ?? 'Image orientation';
    case 'video':
      return labels?.tokenVideoOrientationLabel ?? 'Video orientation';
    case 'input_image':
      return labels?.tokenInputImageLabel ?? 'Image background';
    case 'input_video':
      return labels?.tokenInputVideoLabel ?? 'Video background';
    default:
      if (/^\d+(?:k|p)$/i.test(value)) {
        return value.toUpperCase();
      }

      return value
        .split(/[-_]/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
};

// Portaled dialogs are React descendants but not part of the composer's DOM.
// Let their focus/keyboard handlers run instead of treating them as canvas input.
const outsideComposerDom = (event: { currentTarget?: unknown; target?: unknown }) =>
  typeof Node !== 'undefined' && event.currentTarget instanceof Node && event.target instanceof Node && !event.currentTarget.contains(event.target);

export const stopComposerEvent = <T extends { stopPropagation: () => void; currentTarget?: unknown; target?: unknown }>(
  event: T
) => {
  if (outsideComposerDom(event)) return;
  event.stopPropagation();
};

export const stopComposerKeyboardEvent = <
  T extends {
    stopPropagation: () => void;
    nativeEvent?: { stopImmediatePropagation?: () => void };
    currentTarget?: unknown; target?: unknown;
  },
>(
  event: T
) => {
  if (outsideComposerDom(event)) return;
  event.stopPropagation();
  event.nativeEvent?.stopImmediatePropagation?.();
};

export const resolveAnchoredComposerPosition = ({
  frame,
  viewportWidth,
  viewportHeight,
  composerHeight,
  preferredWidth = 560,
  edgeInset = 16,
  gap = 14,
}: {
  frame: { left: number; top: number; width: number; height: number };
  viewportWidth: number;
  viewportHeight?: number;
  composerHeight?: number;
  preferredWidth?: number;
  edgeInset?: number;
  gap?: number;
}) => {
  const availableWidth = Math.max(0, viewportWidth - edgeInset * 2);
  const composerWidth = Math.min(preferredWidth, availableWidth);
  const preferredLeft = frame.left + frame.width / 2 - composerWidth / 2;
  const maximumLeft = Math.max(
    edgeInset,
    viewportWidth - edgeInset - composerWidth
  );
  const preferredBelowTop = frame.top + frame.height + gap;
  let top = preferredBelowTop;

  if (
    typeof viewportHeight === 'number' &&
    typeof composerHeight === 'number'
  ) {
    const maximumTop = Math.max(
      edgeInset,
      viewportHeight - edgeInset - composerHeight
    );
    const preferredAboveTop = frame.top - gap - composerHeight;

    if (preferredBelowTop + composerHeight <= viewportHeight - edgeInset) {
      top = preferredBelowTop;
    } else if (preferredAboveTop >= edgeInset) {
      top = preferredAboveTop;
    } else {
      top = Math.min(Math.max(preferredBelowTop, edgeInset), maximumTop);
    }
  }

  return {
    left: Math.min(Math.max(preferredLeft, edgeInset), maximumLeft),
    top,
  };
};

export const resolveComposerFocusLayout = ({
  frameHeight,
  viewportHeight,
  composerHeight,
  currentZoom,
  zoomSteps,
  edgeInset = 16,
  titleHeight = 28,
  gap = 14,
}: {
  frameHeight: number;
  viewportHeight: number;
  composerHeight: number;
  currentZoom: number;
  zoomSteps: number[];
  edgeInset?: number;
  titleHeight?: number;
  gap?: number;
}) => {
  const availableFrameHeight = Math.max(
    0,
    viewportHeight - edgeInset * 2 - titleHeight - gap - composerHeight
  );
  const maximumZoom =
    frameHeight > 0 ? availableFrameHeight / frameHeight : currentZoom;
  const shouldReduceZoom = currentZoom > maximumZoom;
  const eligibleZoomSteps = zoomSteps.filter(
    (step) => step <= maximumZoom + 0.01
  );
  const nextZoom = shouldReduceZoom
    ? (eligibleZoomSteps.at(-1) ?? zoomSteps[0] ?? currentZoom)
    : currentZoom;

  return {
    zoom: nextZoom,
    verticalPageOffset:
      (gap + composerHeight - titleHeight) / (2 * Math.max(nextZoom, 0.01)),
  };
};

export const getDraftStatusLabel = (
  card: CanvasGenerationCard,
  labels?: Pick<
    CanvasLabels,
    | 'queuedStatusLabel'
    | 'generatingStatusLabel'
    | 'readyStatusLabel'
    | 'failedStatusLabel'
  >
) => {
  if (card.error?.trim()) {
    return card.error.trim();
  }

  switch (card.status) {
    case 'pending':
      return labels?.queuedStatusLabel ?? 'Queued';
    case 'processing':
      return labels?.generatingStatusLabel ?? 'Generating';
    case 'succeeded':
      return labels?.readyStatusLabel ?? 'Ready';
    case 'failed':
      return labels?.failedStatusLabel ?? 'Failed';
    default:
      return '';
  }
};

export const isDraftCard = (
  card: CanvasCard | null | undefined
): card is CanvasGenerationCard => card?.kind === 'generation';
