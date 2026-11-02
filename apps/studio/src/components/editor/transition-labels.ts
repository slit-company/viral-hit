import { m } from '@/paraglide/messages.js';
import type { TimelineTransitionKind } from '@/core/editor/transition-contract';

/** Explicit accessors keep only these messages in the bundle. */
export const TRANSITION_LABELS: Readonly<Record<TimelineTransitionKind | 'none', () => string>> = {
  none: () => m['ui.editor.transition_none'](),
  crossfade: () => m['ui.editor.transition_crossfade'](),
  'fade-black': () => m['ui.editor.transition_fade_black'](),
  'fade-white': () => m['ui.editor.transition_fade_white'](),
  'wipe-left': () => m['ui.editor.transition_wipe_left'](),
  'wipe-right': () => m['ui.editor.transition_wipe_right'](),
  'wipe-up': () => m['ui.editor.transition_wipe_up'](),
  'wipe-down': () => m['ui.editor.transition_wipe_down'](),
  'slide-left': () => m['ui.editor.transition_slide_left'](),
  'slide-right': () => m['ui.editor.transition_slide_right'](),
  'slide-up': () => m['ui.editor.transition_slide_up'](),
  'slide-down': () => m['ui.editor.transition_slide_down'](),
  'circle-open': () => m['ui.editor.transition_circle_open'](),
  'zoom-in': () => m['ui.editor.transition_zoom_in'](),
};
