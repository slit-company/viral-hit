import { z } from 'zod';

/**
 * Visual transitions play at the start of a base-track clip, over the held
 * last frame of the clip that ends exactly where it starts (or black after a
 * gap). Timeline timing never changes. Names map one-to-one onto FFmpeg xfade;
 * the per-frame math below reproduces xfade in RGB so the editor preview,
 * browser export and server export agree.
 */
export const TIMELINE_TRANSITION_KINDS = [
  'crossfade',
  'fade-black',
  'fade-white',
  'wipe-left',
  'wipe-right',
  'wipe-up',
  'wipe-down',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'circle-open',
  'zoom-in',
] as const;

export type TimelineTransitionKind = (typeof TIMELINE_TRANSITION_KINDS)[number];
export type TimelineTransition = { kind: TimelineTransitionKind; duration: number };

export const MIN_TRANSITION_SECONDS = 0.1;
export const MAX_TRANSITION_SECONDS = 3;
export const DEFAULT_TRANSITION_SECONDS = 0.5;

export const timelineTransitionSchema = z
  .object({
    kind: z.enum(TIMELINE_TRANSITION_KINDS),
    duration: z.number().finite().min(MIN_TRANSITION_SECONDS).max(MAX_TRANSITION_SECONDS),
  })
  .strict();

export const XFADE_TRANSITION_NAMES: Record<TimelineTransitionKind, string> = {
  crossfade: 'fade',
  'fade-black': 'fadeblack',
  'fade-white': 'fadewhite',
  'wipe-left': 'wipeleft',
  'wipe-right': 'wiperight',
  'wipe-up': 'wipeup',
  'wipe-down': 'wipedown',
  'slide-left': 'slideleft',
  'slide-right': 'slideright',
  'slide-up': 'slideup',
  'slide-down': 'slidedown',
  'circle-open': 'circleopen',
  'zoom-in': 'zoomin',
};

/** Insets are fractions of the frame; radial alpha is 1 - smoothstep(0, 1, r + offset), r = distance / half-diagonal. */
export type TransitionMask =
  | { kind: 'none' }
  | { kind: 'rect'; left: number; top: number; right: number; bottom: number }
  | { kind: 'radial'; offset: number };

/** dx/dy are fractions of the frame; scale is centered. */
export type TransitionLayer = { weight: number; dx: number; dy: number; scale: number; mask: TransitionMask };

/** `add` sums weighted layers over black (plus white); `over` stacks the incoming layer over the outgoing one. */
export type TransitionFrame = {
  blend: 'over' | 'add';
  outgoing: TransitionLayer;
  incoming: TransitionLayer;
  white: number;
};

export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const radialMaskAlpha = (offset: number, radius: number) => 1 - smoothstep(0, 1, radius + offset);

const layer = (patch: Partial<TransitionLayer> = {}): TransitionLayer => ({
  weight: 1,
  dx: 0,
  dy: 0,
  scale: 1,
  mask: { kind: 'none' },
  ...patch,
});

const rect = (inset: Partial<{ left: number; top: number; right: number; bottom: number }>): TransitionMask => ({
  kind: 'rect',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  ...inset,
});

/** progress runs from 0 (all outgoing) to 1 (all incoming). */
export function transitionFrame(kind: TimelineTransitionKind, progress: number): TransitionFrame {
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 1));
  const q = 1 - p;
  const over = (outgoing: TransitionLayer, incoming: TransitionLayer): TransitionFrame => ({ blend: 'over', outgoing, incoming, white: 0 });
  switch (kind) {
    case 'crossfade':
      return { blend: 'add', outgoing: layer({ weight: q }), incoming: layer({ weight: p }), white: 0 };
    case 'fade-black':
    case 'fade-white': {
      const leave = smoothstep(0.8, 1, q);
      const arrive = smoothstep(0.2, 1, q);
      return {
        blend: 'add',
        outgoing: layer({ weight: q * leave }),
        incoming: layer({ weight: p * (1 - arrive) }),
        white: kind === 'fade-white' ? q * (1 - leave) + p * arrive : 0,
      };
    }
    case 'wipe-left':
      return over(layer(), layer({ mask: rect({ left: q }) }));
    case 'wipe-right':
      return over(layer(), layer({ mask: rect({ right: q }) }));
    case 'wipe-up':
      return over(layer(), layer({ mask: rect({ top: q }) }));
    case 'wipe-down':
      return over(layer(), layer({ mask: rect({ bottom: q }) }));
    case 'slide-left':
      return over(layer({ dx: -p }), layer({ dx: q }));
    case 'slide-right':
      return over(layer({ dx: p }), layer({ dx: -q }));
    case 'slide-up':
      return over(layer({ dy: -p }), layer({ dy: q }));
    case 'slide-down':
      return over(layer({ dy: p }), layer({ dy: -q }));
    case 'circle-open':
      return over(layer(), layer({ mask: { kind: 'radial', offset: 3 * (q - 0.5) } }));
    case 'zoom-in': {
      const zoom = smoothstep(0.5, 1, q);
      const keep = smoothstep(0, 0.5, q);
      return {
        blend: 'add',
        outgoing: layer({ weight: keep, scale: 1 / Math.max(zoom, 1 / 64) }),
        incoming: layer({ weight: 1 - keep }),
        white: 0,
      };
    }
  }
}

/** Alpha stops for CSS/Canvas radial gradients, sampled along the half-diagonal. */
export function radialMaskStops(offset: number, samples = 16) {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const radius = index / samples;
    return { radius, alpha: radialMaskAlpha(offset, radius) };
  });
}
