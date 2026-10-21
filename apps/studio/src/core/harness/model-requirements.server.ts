import { z } from 'zod';
import { listModelRecipeModels } from './model-recipe.server';
import { listGenerationModelDescriptors } from '../generation-providers/model-catalog';
import { resolveModelOptions } from '../generation-providers/model-controls';
import { validateReferenceCounts } from '../generation-providers/reference-inputs';
import { getWorkspaceEffectRegistryEntry } from '../effects/effect-registry';
import { getGenerationPromptMaxChars } from '../effects/validation';
import { generationModelInput } from './generation-contract';
import { pointerParts } from './bindings';
import type { Plan } from './durable';
import type { ModelRequirements, ModelRequirement } from './model-requirements';

const analysisOptions = z.object({ analysis_depth: z.enum(['standard', 'deep']).optional(), max_output_tokens: z.number().int().min(256).max(8192).optional() });
const overlaps = (a: string[], b: string[]) => a.slice(0, Math.min(a.length, b.length)).every((part, i) => part === b[i]);
/** Loaded metadata only: no executable provider imports, project-media reads, credential hashes or generation intents. */
export function inspectModelRequirements(plan: Plan, deferredInputs: Record<string, string[]> = {}): ModelRequirements {
  const result: ModelRequirements = { status: 'not-applicable', models: [], issues: [], limits: 'Checks loaded model metadata and supplied settings only. Source ownership/bytes, credentials, live availability, output count and model quality are checked separately. No model is executed or installed.' };
  const steps = plan.nodes.filter(node => node.operation === 'generation.model');
  if (!steps.length) return result;
  const models = new Map(listModelRecipeModels().map(model => [model.id, model]));
  const descriptors = new Map(listGenerationModelDescriptors().map(model => [model.id, model]));
  for (const step of steps) {
    const missing = (deferredInputs[step.id] ?? []).map(pointerParts);
    const upstream = (step.bindings ?? []).map(binding => pointerParts(binding.target));
    const deferred = (path: string) => [...missing, ...upstream].some(parts => overlaps(parts, pointerParts(path)));
    const raw = step.input && typeof step.input === 'object' && !Array.isArray(step.input) ? step.input : {};
    const row: ModelRequirement = { step: step.id, modelId: typeof raw.modelId === 'string' && !deferred('/modelId') ? raw.modelId : '(choose model)', kind: typeof raw.mode === 'string' ? raw.mode : 'unknown', status: 'available' };
    result.models.push(row);
    const add = (severity: 'issue' | 'deferred', message: string, input?: string) => result.issues.push({ step: step.id, node: step.id, classType: row.modelId, severity, message, ...(input ? { input } : {}) });
    for (const parts of upstream) {
      if (parts.length === 1 && parts[0] === 'prompt' || parts.length > 1 && parts[0] === 'parameters' || parts.length === 3 && parts[0] === 'references' && /^\d+$/.test(parts[1]) && parts[2] === 'assetId') continue;
      add('issue', 'Upstream bindings may change prompt, option values or a reference asset ID only.', '/' + parts.join('/'));
    }
    if (deferred('/modelId') || deferred('/mode')) { row.status = 'deferred'; add('deferred', 'Choose a model and output kind before checking its requirements.'); continue; }
    const parsed = generationModelInput.safeParse(step.input);
    if (!parsed.success) {
      row.status = 'incompatible';
      for (const issue of parsed.error.issues.slice(0, 8)) add('issue', 'Invalid generation input: ' + issue.code, '/' + issue.path.join('/'));
      continue;
    }
    const input = parsed.data, model = models.get(input.modelId);
    if (!model) { row.status = 'missing'; add('issue', 'Install a provider declaring this exact model ID and a durable runtime identity, then restart the app and worker.'); continue; }
    row.providerId = model.providerId;
    if (!model.available) { row.status = 'unconfigured'; add('issue', 'Required provider configuration is missing. Configure this provider before running.'); }
    if (model.kind !== input.mode) { row.status = 'incompatible'; add('issue', `Recipe expects ${input.mode}; installed model produces ${model.kind}.`, '/mode'); }
    if (input.runtime || input.pins) add('issue', 'Portable recipes must not contain server-owned runtime or source pins.');
    const attempt = (path: string, check: () => void) => {
      if (deferred(path)) { add('deferred', 'Value is supplied by a recipe input or an earlier step; check it before execution.', path); return; }
      try { check(); } catch (error) { add('issue', error instanceof Error && !(error instanceof z.ZodError) ? error.message : 'Value does not match the installed model contract.', path); }
    };
    attempt('/prompt', () => {
      const max = getGenerationPromptMaxChars({ modelId: input.mode === 'analysis' ? 'video-analysis' : input.modelId });
      if (!input.prompt.trim() || input.prompt.trim().length > max) throw Error(`Direction must contain 1–${max} characters.`);
    });
    // Source IDs may be deferred while their fixed declared kinds still determine required counts.
    const kindsDeferred = [...missing, ...upstream].some(parts => parts[0] === 'references' && (parts.length < 3 || parts[2] !== 'assetId'));
    if (kindsDeferred) add('deferred', 'Source kinds/counts are not known until inputs resolve.', '/references');
    else {
      try {
        validateReferenceCounts({ image: input.references.filter(r => r.kind === 'image').length, video: input.references.filter(r => r.kind === 'video').length, audio: input.references.filter(r => r.kind === 'audio').length }, model.references, 'This model');
        if (input.mode === 'analysis' && !input.references.length) throw Error('Analysis requires at least one source.');
        if (input.references.some(ref => ref.role === 'audio_track' && ref.kind !== 'audio')) throw Error('Audio-track references must have audio kind.');
      } catch (error) { add('issue', (error as Error).message, '/references'); }
    }
    if (input.references.length) add('deferred', 'Project source ownership, distinct files, size and content integrity are verified at admission/execution.', '/references');
    const descriptor = descriptors.get(model.id)!;
    const options = input.parameters.provider_options;
    const optionsDeferred = [...missing, ...upstream].some(parts => overlaps(parts, ['parameters', 'provider_options']) && parts.length <= 2);
    if (optionsDeferred) add('deferred', 'Model options will be checked when they resolve.', '/parameters/provider_options');
    else if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) add('issue', 'Model options must be an object.', '/parameters/provider_options');
    else {
      const fixed = { ...(options as Record<string, unknown> | undefined) };
      for (const key of Object.keys(fixed)) if (deferred('/parameters/provider_options/' + key)) { const control = descriptor.controls?.find(control => control.key === key); if (control) fixed[key] = control.default; add('deferred', 'Model option will be checked when its value resolves.', '/parameters/provider_options/' + key); }
      try { resolveModelOptions(descriptor.controls, fixed); } catch (error) { add('issue', error instanceof z.ZodError ? 'Model options do not match the declared types.' : (error as Error).message, '/parameters/provider_options'); }
    }
    const entry = getWorkspaceEffectRegistryEntry(model.id);
    for (const [key, choices] of [['aspect_ratio', entry?.supportedAspectRatios], ['wmDuration', entry?.supportedDurations]] as const) attempt('/parameters/' + key, () => {
      const value = input.parameters[key];
      if (value !== undefined && (!choices || !choices.some(choice => choice === value))) throw Error('Choose a ' + key + ' declared by this model.');
    });
    if (input.mode === 'analysis') for (const key of ['analysis_depth', 'max_output_tokens'] as const) attempt('/parameters/' + key, () => { analysisOptions.parse({ [key]: input.parameters[key] }); });
    if (input.outputIndex > 0) add('deferred', 'The selected output index requires that many returned items; actual output count is not known yet.', '/outputIndex');
    if (row.status === 'available' && result.issues.some(issue => issue.step === step.id && issue.severity === 'issue')) row.status = 'incompatible';
  }
  result.status = result.issues.some(issue => issue.severity === 'issue') ? 'issues' : 'checked';
  return result;
}
