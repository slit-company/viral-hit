/**
 * Relighting and text replacement as instructions any image-edit model can follow. The prompt says what
 * changes and, just as plainly, what must stay, which keeps edit models from redrawing the whole picture.
 */
export const LIGHT_PRESETS = ['golden-hour', 'blue-hour', 'neon-night', 'studio-softbox', 'rim-light', 'overcast', 'candlelight', 'hard-noon'] as const;
export const LIGHT_DIRECTIONS = ['left', 'right', 'front', 'behind', 'above'] as const;
export type LightPreset = (typeof LIGHT_PRESETS)[number];
export type LightDirection = (typeof LIGHT_DIRECTIONS)[number];

const LIGHT: Record<LightPreset, string> = {
  'golden-hour': 'warm, low golden-hour sunlight with long soft shadows',
  'blue-hour': 'cool blue-hour twilight with soft, even light',
  'neon-night': 'night lighting from saturated magenta and cyan neon signs, with colored reflections',
  'studio-softbox': 'clean studio light from a large softbox, soft shadows and a gentle fill',
  'rim-light': 'a strong rim light that outlines the subject against a darker background',
  overcast: 'soft, diffuse overcast daylight with almost no shadows',
  candlelight: 'warm, flickering candlelight with deep shadows',
  'hard-noon': 'hard midday sun with crisp, short shadows',
};
const DIRECTION: Record<LightDirection, string> = { left: 'from the left', right: 'from the right', front: 'from the front', behind: 'from behind the subject', above: 'from above' };

export function relightPrompt(preset: LightPreset, direction: LightDirection, notes = '') {
  return [
    'Relight this image with ' + LIGHT[preset] + ', coming ' + DIRECTION[direction] + '.',
    'Change only the lighting, shadows, highlights and reflections.',
    'Keep the people, their faces and poses, the objects, the composition, the framing and every color of every surface exactly as they are.',
    notes.trim(),
  ].filter(Boolean).join(' ');
}

const quote = (value: string) => '"' + value.replace(/\s+/g, ' ').trim().replace(/"/g, "'") + '"';

export function textEditPrompt(from: string, to: string, notes = '') {
  if (!from.trim() || !to.trim()) throw Error('Enter the text to replace and the new text');
  return [
    'Replace the text ' + quote(from) + ' in this image with ' + quote(to) + '.',
    'Match the original lettering: the same font, weight, size, color, outline, spacing, perspective and position.',
    'Change nothing else in the image.',
    notes.trim(),
  ].filter(Boolean).join(' ');
}
