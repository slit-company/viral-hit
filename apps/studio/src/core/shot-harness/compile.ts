import { shotGroups } from '../creative-canvas/shot-line';
import { cameraMove } from './camera-moves';
import { modelFamily, type ModelFamily } from './model-profiles';
import type { ShotModel, ShotSpec } from './spec';

type Part = { text: string; keep: number };
const term = (group: keyof typeof shotGroups, id: string | undefined) => id ? shotGroups[group].find(item => item.id === id)?.text ?? '' : '';
const sentence = (text: string) => { const value = text.trim().replace(/\s+/g, ' '); return value && !/[.!?"]$/.test(value) ? value + '.' : value; };
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const orientation = (ratio: string) => ratio === '9:16' || ratio === '3:4' ? 'vertical frame' : ratio === '1:1' ? 'square frame' : 'widescreen frame';

/** Drops the least important parts until the prompt fits the model's practical length. */
function fit(parts: Part[], max: number, join: (texts: string[]) => string) {
  const kept = parts.filter(part => part.text.trim());
  const dropped: string[] = [];
  let prompt = join(kept.map(part => part.text));
  while (prompt.length > max && kept.some(part => part.keep < 9)) {
    const lowest = kept.reduce((low, part, index) => part.keep < kept[low].keep ? index : low, 0);
    dropped.push(kept[lowest].text); kept.splice(lowest, 1);
    prompt = join(kept.map(part => part.text));
  }
  return { prompt: prompt.slice(0, max), dropped };
}

const cameraText = (spec: ShotSpec) => spec.moves.map(id => cameraMove(id)?.text).filter(Boolean).join(', then ');

/**
 * Builds the video prompt for one model family. With a start frame the image already fixes the look,
 * so the prompt describes motion and camera only, as image-to-video guides recommend.
 */
export function compileVideoPrompt(spec: ShotSpec, family: ModelFamily, options: { startFrame: boolean; characters: boolean; audio: boolean }) {
  const action = spec.action || 'subtle, natural motion';
  const core = options.startFrame ? cap(spec.subject) + ' ' + action : cap(spec.subject) + (spec.action ? ' ' + spec.action : '');
  const optics = options.startFrame ? [] : [term('size', spec.framing), term('angle', spec.angle), term('lens', spec.lens)].filter(Boolean);
  const camera = [cameraText(spec), ...optics].filter(Boolean).join(', ');
  const setting = options.startFrame ? '' : spec.setting;
  const light = options.startFrame ? '' : term('light', spec.light), look = options.startFrame ? '' : term('look', spec.look);
  const continuity = options.characters && !options.startFrame ? 'Keep the person identical to the reference image: same face, hair and outfit.' : '';
  const audio = options.audio && spec.audio ? 'Audio: ' + sentence(spec.audio) : '';
  const single = 'Single continuous shot with smooth, physically plausible motion.';
  const brackets = family.style === 'bracket' ? [...new Set(spec.moves.flatMap(id => cameraMove(id)?.bracket?.split(',') ?? []))] : [];
  let parts: Part[];
  if (family.style === 'subject-first') parts = [
    { text: sentence(core + (setting ? ' in ' + setting : '')), keep: 9 },
    { text: camera ? 'Camera: ' + sentence(camera) : '', keep: 8 },
    { text: light ? 'Lighting: ' + sentence(light) : '', keep: 5 }, { text: look ? 'Style: ' + sentence(look) : '', keep: 4 },
    { text: spec.mood ? 'Mood: ' + sentence(spec.mood) : '', keep: 3 }, { text: continuity, keep: 7 }, { text: audio, keep: 6 }, { text: single, keep: 2 },
  ];
  else if (family.style === 'motion-first') parts = [
    { text: camera ? sentence('The camera: ' + camera) : '', keep: 9 }, { text: sentence(core + (setting ? ' in ' + setting : '')), keep: 9 },
    { text: sentence([light, look, spec.mood && spec.mood + ' mood'].filter(Boolean).join(', ')), keep: 4 }, { text: continuity, keep: 7 }, { text: audio, keep: 6 },
  ];
  else if (family.style === 'concise') parts = [
    { text: sentence([core, setting, camera, light, look, spec.mood].filter(Boolean).join(', ')), keep: 9 }, { text: continuity, keep: 7 }, { text: audio, keep: 6 },
  ];
  else parts = [
    { text: brackets.length ? '[' + brackets.join(',') + ']' : '', keep: 9 },
    { text: sentence(core + (setting ? ' in ' + setting : '')), keep: 9 },
    { text: camera ? sentence('The shot is a ' + camera) : '', keep: 8 },
    { text: light || look ? sentence(cap([light, look].filter(Boolean).join(', '))) : '', keep: 5 },
    { text: spec.mood ? sentence('The mood is ' + spec.mood) : '', keep: 3 }, { text: continuity, keep: 7 }, { text: audio, keep: 6 }, { text: single, keep: 2 },
  ];
  return fit(parts, family.maxPromptChars, texts => texts.join(' '));
}

/** The still that starts the shot: composition, light and look decided before anything moves. */
export function compileStillPrompt(spec: ShotSpec, family: ModelFamily, options: { characters: boolean }) {
  const optics = [term('size', spec.framing), term('angle', spec.angle), term('lens', spec.lens)].filter(Boolean).join(', ');
  const parts: Part[] = [
    { text: sentence(cap(spec.subject) + (spec.action ? ', ' + spec.action : '') + (spec.setting ? ', in ' + spec.setting : '')), keep: 9 },
    { text: optics ? sentence(cap(optics)) : '', keep: 8 },
    { text: sentence(cap([term('light', spec.light), term('look', spec.look)].filter(Boolean).join(', '))), keep: 6 },
    { text: spec.mood ? sentence(cap(spec.mood) + ' mood') : '', keep: 4 },
    { text: options.characters ? 'Same person as the reference image: keep the face, hair and outfit.' : '', keep: 8 },
    { text: sentence('Cinematic film still, ' + orientation(spec.aspectRatio) + ', sharp focus on the subject, natural skin texture'), keep: 3 },
  ];
  return fit(parts, family.maxPromptChars, texts => texts.join(' '));
}

const ENERGY = new Set(['whip-pan', 'crash-zoom-in', 'crash-zoom-out', 'fpv-drone', 'handheld', 'bullet-time', 'snorricam', 'hyperlapse', 'super-dolly-in']);
const seconds = (value: string) => Number.parseFloat(value);

/** Model controls the harness sets on purpose; anything else keeps the model's default. */
export function compileParameters(spec: ShotSpec, model: ShotModel, notes: string[]) {
  const parameters: Record<string, unknown> = {};
  const ratios = model.supportedAspectRatios ?? [];
  if (ratios.includes(spec.aspectRatio)) parameters.aspect_ratio = spec.aspectRatio;
  else if (ratios.includes('auto')) parameters.aspect_ratio = 'auto';
  else if (ratios.length) { parameters.aspect_ratio = ratios[0]; notes.push(`${model.name} has no ${spec.aspectRatio}; using ${ratios[0]}`); }
  if (model.kind === 'video' && model.supportedDurations?.length) {
    const sorted = [...model.supportedDurations].sort((a, b) => seconds(a) - seconds(b));
    const chosen = sorted.find(value => seconds(value) >= spec.duration - 0.01) ?? sorted.at(-1)!;
    parameters.wmDuration = chosen;
    if (Math.abs(seconds(chosen) - spec.duration) > 0.01) notes.push(`${model.name} renders ${chosen}; trim to ${spec.duration}s in the editor`);
  }
  const options: Record<string, unknown> = {};
  const choose = (key: string, preferred: unknown[]) => {
    const control = model.controls?.find(item => item.key === key);
    if (!control) return;
    if (control.type === 'boolean') { if (typeof preferred[0] === 'boolean') options[key] = preferred[0]; return; }
    const value = preferred.find(candidate => control.choices?.some(choice => choice.value === candidate));
    if (value !== undefined) options[key] = value;
  };
  const audio = Boolean(spec.audio);
  const veoShort = familyFor(model).id === 'veo' && parameters.wmDuration !== '8s';
  choose('resolution', model.kind === 'video' ? (veoShort ? ['720p'] : ['1080p', '1080P', '2K', 'fhd', '720p', '720P']) : ['2K', '2k', '1080p', '1K', '1k', '720p']);
  if (model.kind === 'video') {
    const start = Boolean(spec.startAssetId) || spec.startFrame === 'generate';
    choose('reference_mode', [start ? 'frames' : 'references']);
    choose('image_use', [start ? 'first-frame' : 'references']);
  }
  choose('generate_audio', [audio]);
  choose('sound', [audio ? 'on' : 'off']);
  choose('enhance_prompt', [false]);
  choose('multi_shots', [false]);
  choose('mode', ['pro']);
  choose('camera_model', spec.look === 'film35' ? ['35mm-film'] : spec.look === 'documentary' ? ['dv-camcorder'] : []);
  choose('pacing', spec.moves.some(id => ENERGY.has(id)) ? ['dynamic'] : spec.moves.every(id => id === 'static') && spec.moves.length ? ['calm'] : []);
  choose('light', spec.light === 'backlight' ? ['contre-jour'] : spec.light === 'lowKey' ? ['practicals'] : []);
  if (Object.keys(options).length) parameters.provider_options = options;
  return parameters;
}

export const familyFor = (model: ShotModel) => modelFamily(model.id + ' ' + model.name, model.kind);
