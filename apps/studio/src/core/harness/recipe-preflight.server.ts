import { preflightComfyPlan, type ComfyPreflight } from './comfy-preflight';
import { inspectModelRequirements } from './model-requirements.server';
import type { ModelRequirement } from './model-requirements';
import type { Plan } from './durable';
export type RecipePreflight = ComfyPreflight & { models?: ModelRequirement[] };
/** Preserve native-only responses; combine installed model contracts without calling their runtimes. */
export async function preflightRecipePlan(plan: Plan, options: Parameters<typeof preflightComfyPlan>[1] = {}): Promise<RecipePreflight> {
  const native = await preflightComfyPlan(plan, options);
  const report = inspectModelRequirements(plan, options.deferredInputs);
  if (!report.models.length) return native;
  return { ...native, models: report.models, issues: [...native.issues, ...report.issues],
    status: native.status === 'issues' || report.status === 'issues' ? 'issues' : native.status === 'not-applicable' ? report.status : native.status,
    limits: report.limits + (native.status === 'not-applicable' ? '' : ' ' + native.limits) };
}
