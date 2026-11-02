import type { Plan, NodeSpec, Json } from '../harness/durable';
import { compileParameters, compileStillPrompt, compileVideoPrompt, familyFor } from './compile';
import { pickModel, stillNeed, videoNeed, type RankedModel } from './route';
import { shotSpec, type ShotModel, type ShotSpec, type ShotSpecInput } from './spec';

type Reference = { assetId: string; kind: 'image'; role: 'reference' };
export type ShotStep = { model: ShotModel; prompt: string; dropped: string[]; parameters: Record<string, unknown>; references: Reference[] };
export type ShotProduction = {
  spec: ShotSpec;
  still: ShotStep | null;
  video: ShotStep;
  notes: string[];
  alternatives: { video: Array<Pick<RankedModel, 'score' | 'reasons'> & { id: string; name: string }>; still: Array<Pick<RankedModel, 'score' | 'reasons'> & { id: string; name: string }> };
};
const STILL_PLACEHOLDER = 'pending-still';
const summary = (ranked: RankedModel[]) => ranked.slice(0, 5).map(({ model, score, reasons }) => ({ id: model.id, name: model.name, score, reasons }));

/** Decides models, prompts and settings for a shot without contacting any provider. */
export function prepareShot(input: ShotSpecInput, models: readonly ShotModel[]): ShotProduction {
  const spec = shotSpec.parse(input);
  const notes: string[] = [];
  const skippedServices = new Map<string, string>();
  const noteSkipped = (skipped: RankedModel[]) => { for (const { model } of skipped) skippedServices.set(model.providerLabel ?? model.providerId ?? model.name, model.credit?.reason ?? ''); };
  const characters: Reference[] = spec.characterAssetIds.map(assetId => ({ assetId, kind: 'image', role: 'reference' }));
  let still: ShotStep | null = null, stillRanked: RankedModel[] = [];
  if (!spec.startAssetId && spec.startFrame === 'generate') {
    const picked = pickModel(models, stillNeed(spec), spec.imageModel);
    stillRanked = picked.ranked;
    if (spec.imageModel === 'auto') noteSkipped(picked.skipped);
    const model = picked.chosen.model, compiled = compileStillPrompt(spec, familyFor(model), { characters: characters.length > 0 });
    still = { model, ...compiled, parameters: compileParameters(spec, model, notes), references: characters };
  }
  const start = still || spec.startAssetId;
  const picked = pickModel(models, videoNeed(spec), spec.videoModel);
  if (spec.videoModel === 'auto') noteSkipped(picked.skipped);
  for (const [name, reason] of skippedServices) notes.push(`Skipped ${name}: ${reason}`);
  const model = picked.chosen.model, family = familyFor(model);
  const hasAudio = Boolean(family.nativeAudio || model.controls?.some(control => control.key === 'generate_audio' || control.key === 'sound'));
  if (spec.audio && !hasAudio) notes.push(model.name + ' makes silent video; add the sound in the editor');
  const references: Reference[] = start
    ? [{ assetId: spec.startAssetId ?? STILL_PLACEHOLDER, kind: 'image', role: 'reference' }, ...(spec.endAssetId ? [{ assetId: spec.endAssetId, kind: 'image' as const, role: 'reference' as const }] : [])]
    : characters;
  const compiled = compileVideoPrompt(spec, family, { startFrame: Boolean(start), characters: characters.length > 0, audio: hasAudio });
  if (compiled.dropped.length) notes.push(`Shortened for ${model.name}: ${compiled.dropped.length} detail(s) left out`);
  const video: ShotStep = { model, ...compiled, parameters: compileParameters(spec, model, notes), references };
  return { spec, still, video, notes, alternatives: { video: summary(picked.ranked), still: summary(stillRanked) } };
}

const node = (id: string, step: ShotStep, mode: 'image' | 'video', extra: Partial<NodeSpec> = {}): NodeSpec => ({
  id, operation: 'generation.model', version: '1', cache: false, ...extra,
  input: { schemaVersion: 1, mode, modelId: step.model.id, prompt: step.prompt, parameters: step.parameters, references: step.references, outputIndex: 0 } as unknown as Json,
});

/**
 * One durable run per shot: an optional still, then every take animates that same still.
 * The existing worker pins models, verifies media and records each result as a project asset.
 */
export function shotPlan(projectId: string, production: ShotProduction): Plan {
  const nodes: NodeSpec[] = [];
  if (production.still) nodes.push(node('still', production.still, 'image'));
  for (let index = 0; index < production.spec.variations; index += 1) {
    const usesStill = production.video.references[0]?.assetId === STILL_PLACEHOLDER;
    nodes.push(node('take-' + (index + 1), production.video, 'video', usesStill
      ? { dependsOn: ['still'], bindings: [{ node: 'still', pointer: '/assetId', target: '/references/0/assetId' }] }
      : {}));
  }
  return { projectId, nodes };
}
