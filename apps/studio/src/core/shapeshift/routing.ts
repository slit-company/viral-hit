import type { ShotModel } from '../shot-harness/spec';
import { coveringDuration } from '../studio/source-length';
import type { ShapeshiftMode, ShapeshiftQuality } from './contract';

/**
 * Which connected models can rebuild a video, best first. Services that reported credit come before
 * services that report nothing, and services out of credit are skipped. Within that, each mode has its
 * own order of model families: a dedicated performance or replacement model first, then video editors,
 * then reference-to-video models that regenerate every frame from the source. Higgsfield's Genjutsu and
 * Sume's retired Remix are left out, so Shapeshift runs on other services' models.
 */
const PREFERRED: Record<ShapeshiftMode, RegExp[]> = {
  'motion-transfer': [/act-two/, /motion-control/, /seedance-?2[.-]5/, /minimax-h3/, /wan-?3/, /reference-to-video|reference/],
  'object-swap': [/animate-replace/, /seedance-2\.5-edit/, /aleph/, /kling.*o3.*edit|klingo3|kling-v4.*edit/, /seedance-?2[.-]5/, /minimax-h3/, /wan-?3/, /reference-to-video|reference/],
};
const EXCLUDED = /genjutsu|sume-remix-/;
/** Seedance's video edit declines photos that may show a real person and keeps the source's facial structure, so a face tries other models first. */
const DECLINES_REAL_FACES = /seedance-2\.5-edit/;
/** Models without declared lengths render one piece of up to this many seconds; video editors follow their source up to the maximum. */
export const DEFAULT_PIECE_SECONDS = 10, MAX_PIECE_SECONDS = 15;

export function canShapeshift(model: ShotModel, mode: ShapeshiftMode) {
  const refs = model.referenceInputs;
  if (model.kind !== 'video' || EXCLUDED.test(model.id) || !refs) return false;
  if (refs.video.max < 1 || refs.video.min > 1 || refs.image.max < 1 || refs.image.min > 1 || refs.audio.min > 0) return false;
  const tasks = model.studioTasks;
  if (tasks.includes('video-generate')) return true;
  return mode === 'motion-transfer' ? tasks.includes('motion-transfer') || tasks.includes('motion-control') : tasks.includes('object-swap') || tasks.includes('video-edit');
}

const family = (model: ShotModel, mode: ShapeshiftMode) => {
  const index = PREFERRED[mode].findIndex(pattern => pattern.test(model.id.toLowerCase()));
  return index < 0 ? PREFERRED[mode].length : index;
};
const service = (model: ShotModel) => model.providerLabel ?? model.providerId ?? model.name;
export type RoutingSignals = { refused?: ReadonlySet<string>; realFace?: boolean };
/** Funded services first, then services that report nothing, then models this account was refused recently. */
export const tierOf = (model: ShotModel, signals: RoutingSignals = {}) => signals.refused?.has(model.id) ? 2 : model.credit?.state === 'available' ? 0 : 1;

/** Usable models best first, and the ones skipped because their service is out of credit. */
export function rankShapeshiftModels(models: readonly ShotModel[], mode: ShapeshiftMode, signals: RoutingSignals = {}) {
  const declines = (model: ShotModel) => signals.realFace && DECLINES_REAL_FACES.test(model.id) ? 1 : 0;
  const able = models.filter(model => model.available !== false && canShapeshift(model, mode))
    .sort((left, right) => tierOf(left, signals) - tierOf(right, signals) || declines(left) - declines(right) || family(left, mode) - family(right, mode)
      || (right.health?.score ?? 0) - (left.health?.score ?? 0) || left.id.localeCompare(right.id));
  return { ranked: able.filter(model => model.credit?.state !== 'empty'), skipped: able.filter(model => model.credit?.state === 'empty') };
}

/** The person's pick when it can run this mode, otherwise the best usable model. */
export function pickShapeshiftModel(models: readonly ShotModel[], mode: ShapeshiftMode, requested: string, signals: RoutingSignals = {}) {
  const { ranked, skipped } = rankShapeshiftModels(models, mode, signals);
  if (requested !== 'auto') {
    const exact = [...ranked, ...skipped].find(model => model.id === requested);
    if (!exact) throw Error(requested + ' cannot rebuild a video in this mode. Choose another model or Auto.');
    if (exact.credit?.state === 'empty' && exact.credit.source === 'balance') throw Error(service(exact) + ' has ' + exact.credit.reason + '. Add credits to that account or choose another model.');
    return { chosen: exact, ranked, skipped };
  }
  if (!ranked.length && skipped.length) throw Error('Every service that can do this is out of credit: ' + [...new Set(skipped.map(service))].join(', ') + '. Add credits in that account or connect another service.');
  if (!ranked.length) throw Error('No connected video model can do this yet. Connect fal, Runway, Comfy or Sume in Connections.');
  return { chosen: ranked[0], ranked, skipped };
}

/** One model per variation from the ranked list: a different family each while there are some, repeating when there are fewer. */
export function spreadModels(ranked: readonly ShotModel[], mode: ShapeshiftMode, count: number, signals: RoutingSignals = {}) {
  const chosen: ShotModel[] = [];
  // One tier at a time: a service that reports no balance is used only when funded ones run out of models.
  for (const tier of [0, 1, 2]) {
    const pool = ranked.filter(model => tierOf(model, signals) === tier), families = new Set(chosen.map(model => family(model, mode)));
    for (const model of pool) if (chosen.length < count && !families.has(family(model, mode))) { chosen.push(model); families.add(family(model, mode)); }
    for (const model of pool) if (chosen.length < count && !chosen.includes(model)) chosen.push(model);
  }
  return Array.from({ length: count }, (_, index) => chosen[index % chosen.length]);
}

/** The longest piece the model makes in one go. */
export function longestPiece(model: ShotModel) {
  const lengths = (model.supportedDurations ?? []).map(value => Number.parseFloat(value)).filter(Number.isFinite);
  const source = model.controls?.find(control => control.key === 'source_seconds') as { max?: number } | undefined;
  const editor = model.studioTasks.includes('video-edit') || model.studioTasks.includes('object-swap');
  const longest = lengths.length ? Math.max(...lengths) : typeof source?.max === 'number' ? source.max : editor ? MAX_PIECE_SECONDS : DEFAULT_PIECE_SECONDS;
  return Math.min(MAX_PIECE_SECONDS, longest);
}

const ratio = (value: string) => { const [w, h] = value.split(':').map(Number); return w > 0 && h > 0 ? w / h : null; };
/** The supported aspect ratio closest to the source's shape; auto when the model follows its input. */
export function closestAspect(ratios: readonly string[], width: number, height: number) {
  if (ratios.includes('auto')) return 'auto';
  const target = width / height;
  let best: string | null = null, distance = Infinity;
  for (const value of ratios) { const r = ratio(value); if (r && Math.abs(Math.log(r / target)) < distance) { distance = Math.abs(Math.log(r / target)); best = value; } }
  return best;
}

const QUALITY_ORDER = ['360p', '480p', '540p', '580p', '720p', '768p', '1080p', '2k', '4k'];
const rank = (value: string) => { const index = QUALITY_ORDER.indexOf(value.toLowerCase()); return index < 0 ? Number.parseInt(value, 10) || 0 : index; };
/** The resolution choice matching the requested quality, or the nearest one below it, else the lowest. */
function resolutionFor(choices: readonly string[], quality: ShapeshiftQuality) {
  const exact = choices.find(value => value.toLowerCase() === quality);
  if (exact) return exact;
  const sorted = [...choices].sort((left, right) => rank(left) - rank(right));
  return [...sorted].reverse().find(value => rank(value) <= rank(quality)) ?? sorted[0];
}

/** Generation parameters for one piece: length, shape and the options these models use for this job. */
export function shapeshiftParameters(model: ShotModel, mode: ShapeshiftMode, quality: ShapeshiftQuality, pieceSeconds: number, width: number, height: number) {
  const parameters: Record<string, unknown> = {}, options: Record<string, unknown> = {};
  const duration = coveringDuration(pieceSeconds, model.supportedDurations);
  if (duration) parameters.wmDuration = duration;
  const aspect = closestAspect(model.supportedAspectRatios ?? [], width, height);
  if (aspect) parameters.aspect_ratio = aspect;
  for (const control of model.controls ?? []) {
    const choices = (control.choices ?? []).map(choice => String(choice.value));
    if (control.key === 'resolution' && choices.length) options.resolution = resolutionFor(choices, quality);
    else if (control.key === 'source_seconds') options.source_seconds = Math.max(1, Math.ceil(pieceSeconds - 0.001));
    // Follow the source's orientation, so the movement and camera carry over.
    else if (/orientation/.test(control.key) && choices.includes('video')) options[control.key] = 'video';
    else if (control.key === 'body_control' && mode === 'motion-transfer') options.body_control = true;
    // The source's own sound is put back when the pieces are joined.
    else if (/keep_(original_)?sound/.test(control.key)) options[control.key] = control.type === 'boolean' ? false : choices.includes('no') ? 'no' : control.default;
  }
  if (Object.keys(options).length) parameters.provider_options = options;
  return parameters;
}
