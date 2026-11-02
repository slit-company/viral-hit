import { familyFor } from './compile';
import type { ShotModel, ShotSpec } from './spec';

export type RouteNeed = { kind: 'image' | 'video'; images: number; firstLast: boolean; audio: boolean; duration: number; aspectRatio: string; provider: string };
export type RankedModel = { model: ShotModel; score: number; reasons: string[] };
const seconds = (value: string) => Number.parseFloat(value);

/** What the video step must accept, given how the shot starts. */
export function videoNeed(spec: ShotSpec): RouteNeed {
  const start = Boolean(spec.startAssetId) || spec.startFrame === 'generate';
  const images = start ? (spec.endAssetId ? 2 : 1) : spec.characterAssetIds.length;
  return { kind: 'video', images, firstLast: Boolean(spec.endAssetId), audio: Boolean(spec.audio), duration: spec.duration, aspectRatio: spec.aspectRatio, provider: spec.provider };
}
export const stillNeed = (spec: ShotSpec): RouteNeed =>
  ({ kind: 'image', images: spec.characterAssetIds.length, firstLast: false, audio: false, duration: 0, aspectRatio: spec.aspectRatio, provider: spec.provider });
/** Newer releases of the same family win ties (Seedance 2.5 over 2.0). */
const version = (id: string) => Number(id.match(/(\d+\.\d+)/)?.[1] ?? 0) / 100;

/** Models that can run the step, best first. Hard requirements filter; preferences only reorder. */
export function rankModels(models: readonly ShotModel[], need: RouteNeed): RankedModel[] {
  const task = need.kind === 'video' ? 'video-generate' : 'image-generate';
  const ranked: RankedModel[] = [];
  for (const model of models) {
    if (model.kind !== need.kind || model.available === false) continue;
    if (need.provider !== 'any' && model.providerId !== need.provider) continue;
    const tasks = model.studioTasks;
    if (!tasks.includes(task) && !(need.kind === 'image' && need.images > 0 && tasks.includes('image-edit'))) continue;
    const image = model.referenceInputs?.image ?? { min: 0, max: 0 };
    if (image.min > need.images || image.max < need.images) continue;
    const family = familyFor(model), id = model.id.toLowerCase(), reasons = [family.id];
    let score = family.rank + version(id);
    if (need.kind === 'video' && need.images > 0) {
      if (/image-to-video|first-last|i2v/.test(id)) { score += 3; reasons.push('made for animating a frame'); }
      if (need.firstLast && /first-last/.test(id)) { score += 4; reasons.push('first and last frame'); }
      if (/reference-to-video|video-edit|extend/.test(id)) score -= 6;
    }
    if (need.kind === 'video' && need.images === 0 && /image-to-video|first-last/.test(id)) score -= 8;
    if (need.kind === 'image' && need.images > 0 && family.identity) { score += 3; reasons.push('keeps identity from references'); }
    const hasAudio = model.controls?.some(control => control.key === 'generate_audio' || control.key === 'sound');
    if (need.audio) { if (family.nativeAudio && hasAudio) { score += 4; reasons.push('native audio'); } else score -= 12; }
    const durations = (model.supportedDurations ?? []).map(seconds);
    if (need.kind === 'video' && durations.length && !durations.some(value => value >= need.duration - 0.01)) { score -= 10; reasons.push('shorter than the shot'); }
    const ratios = model.supportedAspectRatios ?? [];
    if (ratios.length && !ratios.includes(need.aspectRatio) && !(ratios.includes('auto') && need.images > 0)) { score -= 8; reasons.push('different aspect ratio'); }
    ranked.push({ model, score, reasons });
  }
  return ranked.sort((left, right) => right.score - left.score || left.model.id.localeCompare(right.model.id));
}

/** The chosen model: the person's pick when it qualifies, otherwise the best ranked one. */
export function pickModel(models: readonly ShotModel[], need: RouteNeed, requested: string) {
  const ranked = rankModels(models, need);
  if (requested !== 'auto') {
    const exact = ranked.find(item => item.model.id === requested);
    if (!exact) throw Error(`${requested} cannot run this ${need.kind} step (task, inputs or connection)`);
    return { chosen: exact, ranked };
  }
  if (!ranked.length) throw Error(need.provider === 'any' ? `No connected ${need.kind} model can run this step. Connect one in Connections.` : `${need.provider} has no connected ${need.kind} model for this step`);
  return { chosen: ranked[0], ranked };
}
