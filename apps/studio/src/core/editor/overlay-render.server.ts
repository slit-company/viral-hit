import { overlayMotionSchema, type OverlayKeyframe } from './overlay-motion';
import type { TimelineClip, TimelineOverlayTransform } from './timeline-document';

const number = (value: number) => {
  if (!Number.isFinite(value)) throw Error('Overlay render values must be finite.');
  return value.toFixed(6);
};
const eased = (t: string, easing: OverlayKeyframe['easing']) => {
  if (easing === 'ease-in') return `pow(${t},2)`;
  if (easing === 'ease-out') return `(1-pow(1-${t},2))`;
  if (easing === 'ease-in-out') return `if(lt(${t},0.5),2*pow(${t},2),1-2*pow(1-${t},2))`;
  return t;
};
/** Compile numbers from the validated contract; external expressions are never accepted. */
export function overlayExpression(clip: TimelineClip, field: keyof TimelineOverlayTransform, clock: string) {
  if (!clip.overlay) throw Error('Overlay transform is missing.');
  const frames = clip.motion ? overlayMotionSchema.parse(clip.motion).keyframes : [];
  if (!frames.length) return number(clip.overlay[field]);
  const terms = [number(frames[0][field])];
  for (let index = 1; index < frames.length; index++) {
    const a = frames[index - 1], b = frames[index];
    if (b[field] === a[field]) continue;
    const progress = `clip(((${clock})-${number(a.time)})/${number(b.time - a.time)},0,1)`;
    terms.push(`${number(b[field] - a[field])}*${eased(progress, a.easing)}`);
  }
  return `(${terms.join('+')})`;
}

export function buildOverlayFilters({ clip, inputIndex, inputWidth, inputHeight, width, height, visualLabel, index, sourceInPoint = clip.inPoint }: {
  clip: TimelineClip; sourceInPoint?: number; inputIndex: number; inputWidth: number; inputHeight: number;
  width: number; height: number; visualLabel: string; index: number;
}) {
  if (!clip.overlay || inputWidth <= 0 || inputHeight <= 0) throw Error('Invalid overlay dimensions.');
  const prepared = `overlay${index}`, output = `withoverlay${index}`;
  const localClock = `t+${number(clip.inPoint)}`;
  const globalClock = `t-${number(clip.startTime)}+${number(clip.inPoint)}`;
  const animatedRotation = clip.motion?.keyframes.some(frame => frame.rotation !== 0);
  const rotated = animatedRotation || (!clip.motion && clip.overlay.rotation !== 0);
  const maxWidth = Math.max(...(clip.motion?.keyframes.map(frame => frame.width) ?? [clip.overlay.width])) * width;
  // A fixed transparent rotation canvas prevents later larger poses being clipped.
  const diagonal = Math.ceil(Math.hypot(maxWidth, maxWidth * inputHeight / inputWidth)) + 4;
  if (rotated && diagonal * diagonal > 64 * 1024 * 1024) throw Error('Overlay rotation exceeds the 64-megapixel working canvas. Reduce width or crop the source.');
  const steps = [
    `trim=start=${number(clip.sourceType === 'video' ? sourceInPoint : 0)}:duration=${number(clip.duration)}`, 'setpts=PTS-STARTPTS',
    `scale=${Math.max(1, Math.round(maxWidth))}:-1`,
    'format=rgba',
  ];
  const opacity = overlayExpression(clip, 'opacity', `T+${number(clip.inPoint)}`);
  const fadeIn = clip.fadeIn > 0 ? `min(1,T/${number(clip.fadeIn)})` : '1';
  const fadeOut = clip.fadeOut > 0 ? `max(0,min(1,(${number(clip.duration)}-T)/${number(clip.fadeOut)}))` : '1';
  const variesOpacity = clip.motion?.keyframes.some(frame => frame.opacity !== clip.motion!.keyframes[0].opacity);
  if (variesOpacity || clip.fadeIn > 0 || clip.fadeOut > 0) {
    steps.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${opacity}*min(${fadeIn},${fadeOut})'`);
  } else steps.push(`colorchannelmixer=aa=${number(clip.motion?.keyframes[0].opacity ?? clip.overlay.opacity)}`);
  if (rotated) steps.push(`rotate=angle='${overlayExpression(clip, 'rotation', localClock)}*PI/180':ow=${diagonal}:oh=${diagonal}:c=black@0`);
  steps.push(`scale=w='max(1,round(iw*${width}*${overlayExpression(clip, 'width', localClock)}/${number(Math.max(1, Math.round(maxWidth)))}))':h=-1:eval=frame`);
  steps.push(`setpts=PTS-STARTPTS+${number(clip.startTime)}/TB`);
  return { output, filters: [
    `[${inputIndex}:v]${steps.join(',')}[${prepared}]`,
    `[${visualLabel}][${prepared}]overlay=x='${width}*${overlayExpression(clip, 'x', globalClock)}-overlay_w/2':` +
      `y='${height}*${overlayExpression(clip, 'y', globalClock)}-overlay_h/2':eof_action=pass:` +
      `enable='gte(t,${number(clip.startTime)})*lt(t,${number(clip.startTime + clip.duration)})'[${output}]`,
  ] };
}
