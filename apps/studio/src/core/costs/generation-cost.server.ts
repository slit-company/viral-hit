import type { Json } from '../harness/durable';
import { getGenerationModelDescriptor } from '../generation-providers/model-catalog';
import { resolveModelOptions } from '../generation-providers/model-controls';
import { costRequest, estimateCost, sumCosts, type CostEstimate, type CostTotal } from './pricing';

const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, Json>;

/**
 * The estimate for one generation from its model's published price and the request's settings,
 * or null when the model lists none. sourceSeconds prices tools billed by the source video's length.
 */
export function estimateGenerationStep(input: unknown, sourceSeconds?: number | null): CostEstimate | null {
  const step = record(input), parameters = record(step.parameters);
  const model = typeof step.modelId === 'string' ? getGenerationModelDescriptor(step.modelId) : null;
  if (!model?.pricing) return null;
  let options: Record<string, unknown>;
  try { options = resolveModelOptions(model.controls, parameters.provider_options); } catch { options = {}; }
  return estimateCost(model.pricing, costRequest({ duration: parameters.wmDuration ?? parameters.duration, defaultDuration: model.defaultParameters.wmDuration, sourceSeconds, prompt: step.prompt, options }));
}

/** Totals for a plan's generation steps; other operations are free here. */
export function estimatePlanCost(nodes: readonly { operation: string; input: unknown }[]): CostTotal {
  return sumCosts(nodes.filter(node => node.operation === 'generation.model').map(node => estimateGenerationStep(node.input)));
}
