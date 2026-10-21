import { installGenerationProviders } from '../generation-providers/installed/install.server';
import { listGenerationModelDescriptors, type GenerationModelDescriptor } from '../generation-providers/model-catalog';
import { getGenerationProvider } from '../generation-providers/registry';
import { resolveAnalysisInputs } from '../generation-providers/analysis-inputs';
import { resolveAudioReferenceInputs, REFERENCE_MEDIA_KINDS, validateReferenceCounts } from '../generation-providers/reference-inputs';
import { getWorkspaceEffectRegistryEntry } from '../effects/effect-registry';
import { getWorkspaceMediaSchema } from '../effects/workspace-media';
import { getGenerationPromptMaxChars } from '../effects/validation';
import type { ModelControl } from '../generation-providers/model-controls';
import { fingerprint, type Json } from './durable';
import { compileRecipeForCheck, recipeSchema, type Recipe } from './recipes';
import { RecipeConflictError } from './recipe-database.server';
import { modelRecipeDefinition, type ModelRecipeModel } from './model-recipe-contract';

type Exposure = { parameter: Recipe['parameters'][number]; target: string };
function option(control: ModelControl): Exposure {
  const common = { id: `option-${control.key.replaceAll('_', '-')}`, label: control.label, ...(control.description ? { description: control.description } : {}) };
  const parameter: Recipe['parameters'][number] = control.type === 'select' ? { ...common, type: 'enum', options: control.choices.map(choice => choice.value), default: control.default }
    : control.type === 'number' ? { ...common, type: 'number', min: control.min, max: control.max, integer: control.integer, default: control.default }
    : control.type === 'string' ? { ...common, type: 'string', multiline: control.multiline ?? false, minLength: 0, maxLength: control.maxLength, default: control.default }
    : { ...common, type: 'boolean', default: control.default };
  return { parameter, target: `/parameters/provider_options/${control.key}` };
}
function source(model: GenerationModelDescriptor) {
  const entry = getWorkspaceEffectRegistryEntry(model.id), media = getWorkspaceMediaSchema(model.id);
  const references = model.kind === 'analysis' ? resolveAnalysisInputs(model.analysisInputs) : model.referenceInputs ?? (model.kind === 'audio' ? resolveAudioReferenceInputs() : {
    image: { min: entry?.requiresImageInput ? 1 : 0, max: media?.image.max ?? 0 }, video: { min: 0, max: media?.video.max ?? 0 }, audio: { min: 0, max: media?.audio.max ?? 0 },
  });
  const exposures: Exposure[] = [{ parameter: { id: 'prompt', label: 'Direction', type: 'string', multiline: true, minLength: 1, maxLength: getGenerationPromptMaxChars({ modelId: model.kind === 'analysis' ? 'video-analysis' : model.id }) }, target: '/prompt' }];
  for (const [id, label, key, choices] of [
    ['aspect-ratio', 'Aspect ratio', 'aspect_ratio', entry?.supportedAspectRatios],
    ['duration', 'Duration', 'wmDuration', entry?.supportedDurations],
  ] as const) {
    if (choices?.length) exposures.push({ parameter: { id, label, type: 'enum', options: [...choices], default: String(model.defaultParameters[key] ?? choices[0]) }, target: `/parameters/${key}` });
  }
  exposures.push(...(model.controls ?? []).map(option));
  const projection = { id: model.id, name: model.name, providerId: model.providerId, kind: model.kind, available: model.available, references, parameters: exposures.map(item => item.parameter) };
  // Public contract identity only: no code, credential hash or environment values are exposed.
  const digest = fingerprint(JSON.parse(JSON.stringify({ ...projection, defaults: model.defaultParameters, targets: exposures.map(item => item.target) })) as Json);
  return { model, exposures, publicModel: { ...projection, digest } satisfies ModelRecipeModel };
}
function sources() {
  installGenerationProviders();
  return listGenerationModelDescriptors().filter(model => Boolean(getGenerationProvider(model.providerId)?.executionIdentity)).map(source);
}
/** Data-only discovery; never import a provider module, probe an account or allocate a generation intent. */
export function listModelRecipeModels(): ModelRecipeModel[] { return sources().map(item => item.publicModel); }

export function buildModelRecipe(raw: unknown, expectedModelDigest: string): Recipe {
  const { modelId, referenceCounts, outputIndex, ...metadata } = modelRecipeDefinition.parse(raw);
  const found = sources().find(item => item.model.id === modelId);
  if (!found) throw new RecipeConflictError('Installed model is unavailable. Refresh models and choose a current definition.');
  const { model, exposures, publicModel } = found;
  if (publicModel.digest !== expectedModelDigest) throw new RecipeConflictError('Model definition changed after discovery. Refresh models and review the current source counts and controls.');
  validateReferenceCounts(referenceCounts, publicModel.references, model.name);
  const total = REFERENCE_MEDIA_KINDS.reduce((sum, kind) => sum + referenceCounts[kind], 0);
  if (total > 20 || (model.kind === 'analysis' && total === 0)) throw Error('Choose at most 20 sources; analysis needs at least one source');
  if (model.kind === 'analysis' && outputIndex !== 0) throw Error('Analysis has one report output');
  const parameters = structuredClone(exposures.map(item => item.parameter));
  const bindings = exposures.map(item => ({ parameter: item.parameter.id, target: item.target }));
  const references: { assetId: string; kind: 'image' | 'video' | 'audio'; role: 'reference' | 'audio_track' }[] = [];
  for (const kind of REFERENCE_MEDIA_KINDS) for (let i = 0; i < referenceCounts[kind]; i++) {
    const id = `${kind}-${i + 1}`;
    parameters.push({ id, label: `${kind[0].toUpperCase() + kind.slice(1)} source ${i + 1}`, type: 'asset', kind });
    bindings.push({ parameter: id, target: `/references/${references.length}/assetId` });
    references.push({ assetId: 'choose-project-source', kind, role: kind === 'audio' ? 'audio_track' : 'reference' });
  }
  const recipe = recipeSchema.parse({ ...metadata, parameters, nodes: [{ id: 'model', operation: 'generation.model', version: '1', cache: false,
    input: { schemaVersion: 1, mode: model.kind, modelId, prompt: '', references, parameters: structuredClone(model.defaultParameters), outputIndex }, parameters: bindings }] });
  compileRecipeForCheck(recipe, {}, 'model-recipe-inspection-only');
  if (Buffer.byteLength(JSON.stringify(recipe)) > 128_000) throw Error('Model recipe exceeds 128 KB');
  return JSON.parse(JSON.stringify(recipe)) as Recipe;
}
