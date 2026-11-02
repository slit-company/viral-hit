import type { ReactNode } from 'react';

type Motion = { layer: 'scene' | 'background'; type: 'scale' | 'translate' | 'rotate'; values: string; dur: number; keyTimes?: string };
const scale = (values: string, dur = 2.4, keyTimes?: string): Motion => ({ layer: 'scene', type: 'scale', values, dur, keyTimes });
const shift = (values: string, dur = 2.4, layer: Motion['layer'] = 'scene'): Motion => ({ layer, type: 'translate', values, dur });

/** A tiny looping diagram of each move, so people can see the move instead of reading its name. */
const MOTIONS: Record<string, Motion | null> = {
  static: null,
  'dolly-in': scale('1;1.35'), 'dolly-out': scale('1.35;1'), 'super-dolly-in': scale('1;1.7', 1.6), 'low-angle-push': scale('1;1.4'), 'through-object': scale('0.8;1.5', 2),
  'crash-zoom-in': scale('1;1.9;1.9', 1.8, '0;0.2;1'), 'crash-zoom-out': scale('1.9;1;1', 1.8, '0;0.2;1'),
  'dolly-zoom': { layer: 'background', type: 'scale', values: '1;1.6', dur: 2.4 },
  'orbit-left': shift('-10 0;10 0', 2.4, 'background'), 'orbit-right': shift('10 0;-10 0', 2.4, 'background'), 'orbit-360': shift('-14 0;14 0;-14 0', 3, 'background'),
  'lazy-susan': shift('-6 0;6 0;-6 0', 4, 'background'),
  'pan-left': shift('0 0;12 0'), 'pan-right': shift('0 0;-12 0'), 'whip-pan': shift('0 0;-28 0;-28 0', 1.2),
  'truck-left': shift('0 0;10 0', 2.4, 'background'), 'truck-right': shift('0 0;-10 0', 2.4, 'background'),
  'tilt-up': shift('0 -6;0 8'), 'tilt-down': shift('0 8;0 -6'), 'crane-up': { layer: 'scene', type: 'translate', values: '0 -4;0 10', dur: 2.4 }, 'crane-down': shift('0 10;0 -4'),
  overhead: { layer: 'scene', type: 'rotate', values: '0 32 20;20 32 20', dur: 3 }, 'aerial-reveal': scale('1.5;0.9', 3),
  tracking: shift('0 0;-16 0', 1.6, 'background'), leading: shift('0 0;16 0', 1.6, 'background'), 'side-tracking': shift('0 0;-18 0', 1.4, 'background'),
  'fpv-drone': scale('1;1.6;1', 1.4), hyperlapse: shift('0 0;-24 0', 0.8, 'background'),
  handheld: shift('0 0;1 -1;-1 1;1 1;0 0', 0.9), snorricam: shift('0 0;-6 2;6 -2;0 0', 1.2, 'background'),
  'bullet-time': { layer: 'background', type: 'rotate', values: '-12 32 20;12 32 20', dur: 2.4 }, 'rack-focus': scale('1;1.05;1', 2),
};

function Animated({ motion, children }: { motion: Motion | null; children: ReactNode }) {
  if (!motion) return <g>{children}</g>;
  const animate = <animateTransform attributeName="transform" type={motion.type} values={motion.values} dur={motion.dur + 's'} repeatCount="indefinite" keyTimes={motion.keyTimes} />;
  // Scaling runs around the frame center.
  return motion.type === 'scale'
    ? <g transform="translate(32 20)"><g>{animate}<g transform="translate(-32 -20)">{children}</g></g></g>
    : <g>{animate}{children}</g>;
}

export function CameraMovePreview({ move }: { move: string }) {
  const motion = MOTIONS[move] ?? null;
  const background = <g>
    <rect x="-20" y="-20" width="104" height="40" fill="var(--vh-control)" />
    <rect x="-20" y="27" width="104" height="40" fill="var(--vh-border)" />
    {[-14, 2, 42, 58, 74].map((x, index) => <rect key={x} x={x} y={10 - (index % 3) * 4} width="9" height={17 + (index % 3) * 4} rx="1" fill="var(--vh-text-3)" opacity="0.35" />)}
  </g>;
  const subject = <g><circle cx="32" cy="15" r="3.4" fill="var(--vh-text-1)" /><rect x="28.5" y="19" width="7" height="9" rx="2.5" fill="var(--color-brand-lime, #b7e13d)" /></g>;
  return <svg viewBox="0 0 64 40" className="block h-full w-full" aria-hidden="true">
    <clipPath id={'frame-' + move}><rect width="64" height="40" rx="5" /></clipPath>
    <g clipPath={`url(#frame-${move})`}>
      {motion?.layer === 'background'
        ? <><Animated motion={motion}>{background}</Animated>{subject}</>
        : <Animated motion={motion}>{background}{subject}</Animated>}
    </g>
  </svg>;
}
