import { familyFor } from './compile';
import type { ShotModel, ShotSpec } from './spec';

export type RouteNeed = { kind: 'image' | 'video'; images: number; firstLast: boolean; imageMode?: 'frames' | 'references'; audio: boolean; duration: number; aspectRatio: string; provider: string };
export type RankedModel = { model: ShotModel; score: number; reasons: string[] };
const seconds = (value: string) => Number.parseFloat(value);

/** What the video step must accept, given how the shot starts. */
export function videoNeed(spec: ShotSpec): RouteNeed {
  const start = Boolean(spec.startAssetId) || spec.startFrame === 'generate';
  const images = start ? (spec.endAssetId ? 2 : 1) : spec.characterAssetIds.length;
  return { kind: 'video', images, firstLast: Boolean(spec.endAssetId), imageMode: start ? 'frames' : 'references', audio: Boolean(spec.audio), duration: spec.duration, aspectRatio: spec.aspectRatio, provider: spec.provider };
}
export const stillNeed = (spec: ShotSpec): RouteNeed =>
  ({ kind: 'image', images: spec.characterAssetIds.length, firstLast: false, audio: false, duration: 0, aspectRatio: spec.aspectRatio, provider: spec.provider });
/** Newer releases of the same family win ties (Seedance 2.5 over 2.0). */
const version = (id: string) => Number(id.match(/(\d+\.\d+)/)?.[1] ?? 0) / 100;

/** Models that can run the step, best first. Hard requirements filter; preferences only reorder. */
export function rankModels(models: readonly ShotModel[], need: RouteNeed, { includeEmpty = false } = {}): RankedModel[] {
  const task = need.kind === 'video' ? 'video-generate' : 'image-generate';
  const ranked: RankedModel[] = [];
  for (const model of models) {
    if (model.kind !== need.kind || model.available === false) continue;
    if (model.credit?.state === 'empty' && !includeEmpty) continue;
    if (need.provider !== 'any' && model.providerId !== need.provider) continue;
    const tasks = model.studioTasks;
    if (!tasks.includes(task) && !(need.kind === 'image' && need.images > 0 && tasks.includes('image-edit'))) continue;
    const image = model.referenceInputs?.image ?? { min: 0, max: 0 };
    if (image.min > need.images || image.max < need.images) continue;
    if ((model.referenceInputs?.video.min ?? 0) > 0 || (model.referenceInputs?.audio.min ?? 0) > 0) continue;
    if (need.kind === 'video' && need.images > 0) {
      const mode = need.imageMode ?? 'frames', modes = model.videoImageInputs;
      if ((modes?.[mode] ?? 0) < need.images) continue;
      if (need.firstLast && (!modes?.frames || modes.frames < 2)) continue;
    }
    const family = familyFor(model), id = model.id.toLowerCase(), reasons = [family.id];
    let score = family.rank + version(id);
    if (model.health) { score += model.health.score; reasons.push(model.health.reason); }
    if (model.credit?.state === 'available') reasons.push(model.credit.reason);
    if (need.kind === 'video' && need.images > 0) {
      // The capability filter above already proved the declared mode; rank by family and fit, not endpoint naming.
      reasons.push((need.imageMode ?? 'frames') === 'frames' ? (need.firstLast ? 'first and last frame' : 'animates the start frame') : 'uses the reference images');
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

const service = (model: ShotModel) => model.providerLabel ?? model.providerId ?? model.name;

/**
 * The chosen model: the person's pick when it qualifies, otherwise the best ranked one. Services that
 * are out of credit are skipped for auto routing; a pick is refused only when the service itself
 * reported an empty balance (a failed run alone may be stale after a top-up).
 */
export function pickModel(models: readonly ShotModel[], need: RouteNeed, requested: string) {
  const all = rankModels(models, need, { includeEmpty: true });
  const ranked = all.filter(item => item.model.credit?.state !== 'empty');
  const skipped = all.filter(item => item.model.credit?.state === 'empty');
  if (requested !== 'auto') {
    const exact = all.find(item => item.model.id === requested);
    if (!exact) throw Error(`${requested} cannot run this ${need.kind} step (task, inputs or connection)`);
    if (exact.model.credit?.state === 'empty' && exact.model.credit.source === 'balance') throw Error(`${service(exact.model)} has ${exact.model.credit.reason}. Add credits to that account or choose another model.`);
    return { chosen: exact, ranked, skipped };
  }
  if (!ranked.length && skipped.length) {
    const services = [...new Map(skipped.map(item => [service(item.model), item.model.credit!.reason])).entries()].map(([name, reason]) => name + ' (' + reason + ')');
    throw Error(`Every service that can run this ${need.kind} step is out of credit: ${services.join(', ')}. Add credits to one of these accounts (Connections shows each balance) or connect another service.`);
  }
  if (!ranked.length) throw Error(need.provider === 'any' ? `No connected ${need.kind} model can run this step. Connect one in Connections.` : `${need.provider} has no connected ${need.kind} model for this step`);
  return { chosen: ranked[0], ranked, skipped };
}
