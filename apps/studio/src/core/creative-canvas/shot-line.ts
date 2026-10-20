/**
 * Cinematography choices live in one plain "Shot:" line of a generation prompt. Any model reads the same
 * text, people can edit it by hand, and agents can write it through the normal prompt fields.
 */
const option = (id: string, text: string) => ({ id, text });
export const shotGroups = {
  size: [option('extremeWide', 'extreme wide shot'), option('wide', 'wide shot'), option('medium', 'medium shot'), option('closeUp', 'close-up'), option('extremeCloseUp', 'extreme close-up')],
  angle: [option('eyeLevel', 'eye level'), option('low', 'low angle'), option('high', 'high angle'), option('overhead', 'overhead shot'), option('dutch', 'dutch angle')],
  lens: [option('wide24', '24mm wide lens'), option('standard35', '35mm lens'), option('normal50', '50mm lens'), option('portrait85', '85mm portrait lens'), option('macro', 'macro lens')],
  move: [option('static', 'static camera'), option('pushIn', 'slow push in'), option('pullOut', 'slow pull out'), option('panLeft', 'pan left'), option('panRight', 'pan right'), option('tiltUp', 'tilt up'),
    option('tiltDown', 'tilt down'), option('orbit', 'orbit around the subject'), option('craneUp', 'crane up'), option('tracking', 'tracking shot'), option('handheld', 'handheld camera'), option('dollyZoom', 'dolly zoom')],
  light: [option('natural', 'natural light'), option('goldenHour', 'golden hour'), option('softStudio', 'soft studio light'), option('neon', 'neon light'), option('lowKey', 'low-key lighting'), option('backlight', 'backlight')],
  look: [option('film35', '35mm film look'), option('documentary', 'documentary look'), option('commercial', 'glossy commercial look'), option('anime', 'anime style'), option('blackWhite', 'black and white')],
} as const;
export type ShotGroup = keyof typeof shotGroups;
export type ShotOptionId = (typeof shotGroups)[ShotGroup][number]['id'];
export type Shot = Partial<Record<ShotGroup, ShotOptionId>>;
export const shotGroupOrder = Object.keys(shotGroups) as ShotGroup[];
/** Camera moves only make sense for video; still images keep framing, lens, light and look. */
export const shotGroupsFor = (mediaType: 'image' | 'video') => shotGroupOrder.filter(group => mediaType === 'video' || group !== 'move');

const PREFIX = 'Shot: ';
const isShotLine = (line: string) => line.startsWith(PREFIX);

/** Reads the Shot line; terms that are not built-in options are kept as custom terms. */
export function parseShotLine(prompt: string): { shot: Shot; custom: string[] } {
  const line = prompt.split('\n').find(isShotLine);
  const shot: Shot = {}, custom: string[] = [];
  for (const term of (line ?? '').slice(PREFIX.length).replace(/\.\s*$/, '').split(',').map(item => item.trim()).filter(Boolean)) {
    const group = shotGroupOrder.find(name => shotGroups[name].some(item => item.text === term));
    if (group) shot[group] = shotGroups[group].find(item => item.text === term)!.id;
    else custom.push(term);
  }
  return { shot, custom };
}

/** Rewrites only the Shot line, at the end of the prompt, keeping custom terms; an empty shot removes it. */
export function writeShotLine(prompt: string, shot: Shot, mediaType: 'image' | 'video') {
  const { custom } = parseShotLine(prompt);
  const terms = [...shotGroupsFor(mediaType).flatMap(group => shotGroups[group].filter(item => item.id === shot[group]).map(item => item.text)), ...custom];
  const body = prompt.split('\n').filter(line => !isShotLine(line)).join('\n').trimEnd();
  if (!terms.length) return body;
  return (body ? body + '\n' : '') + PREFIX + terms.join(', ') + '.';
}
