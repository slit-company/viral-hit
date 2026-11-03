import { z } from 'zod';

/**
 * What one generation costs on its service, as the service publishes it. Estimates help choose a
 * model and approve a run; they never block one, and reference extras and taxes are left out.
 */
/** Credit-based services are converted at their fixed price; characters are ElevenLabs credits. */
export const PRICE_CURRENCIES = ['USD', 'characters'] as const;
export const PRICE_UNITS = ['second', 'output', 'request', 'megapixel', 'character'] as const;
export type PriceCurrency = (typeof PRICE_CURRENCIES)[number];
const rate = z.number().finite().min(0).max(100_000);
const optionKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
/** The amounts key for the chosen options, or undefined when one of them is unset. */
function byKey(by: { option: string | string[] }, options?: Readonly<Record<string, unknown>> | null) {
  const values = (Array.isArray(by.option) ? by.option : [by.option]).map(name => options?.[name]);
  return values.some(value => value === undefined || value === null) ? undefined : values.map(String).join('|');
}

export const modelPricingSchema = z.object({
  currency: z.enum(PRICE_CURRENCIES),
  /** second: of output; output: per image or clip made; character: of the script; request: per call. */
  per: z.enum(PRICE_UNITS),
  /** The rate when `by` lists no value for the chosen option, or always without `by`. */
  amount: rate.optional(),
  /** Rates by an option's value, such as resolution or the voice model; with several options the key joins their values with |, such as 720p|true. */
  by: z.object({ option: z.union([optionKey, z.array(optionKey).min(2).max(3)]), amounts: z.record(z.string().min(1).max(60), rate) }).strict().optional(),
  /** Smallest charge for one request. */
  minimum: rate.optional(),
  /** list: the published rate; average: what the service reports as its average per request. */
  basis: z.enum(['list', 'average']).default('list'),
  source: z.string().url().max(300),
  checked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict().refine(value => value.amount !== undefined || value.by !== undefined, 'Give an amount or amounts by option');
export type ModelPricing = z.infer<typeof modelPricingSchema>;

export type CostRequest = { seconds?: number | null; outputs?: number | null; characters?: number | null; megapixels?: number | null; options?: Readonly<Record<string, unknown>> | null };
export type CostEstimate = { amount: number; currency: PriceCurrency; basis: 'list' | 'average' };
export type CostTotal = { totals: CostEstimate[]; unpriced: number };

const round = (value: number, currency: PriceCurrency) => currency === 'USD' ? Math.round(value * 10_000) / 10_000 : Math.ceil(value - 1e-9);

/** The rate for one unit with the chosen options, such as the price per second before a length is known. */
export function unitRate(pricing: ModelPricing | null | undefined, options?: Readonly<Record<string, unknown>> | null): CostEstimate | null {
  if (!pricing) return null;
  const key = pricing.by ? byKey(pricing.by, options) : undefined;
  const unit = (pricing.by && key !== undefined ? pricing.by.amounts[key] : undefined) ?? pricing.amount;
  return unit === undefined ? null : { amount: unit, currency: pricing.currency, basis: pricing.basis };
}

/** The cost of one request, or null when the model lists no price for what was asked. */
export function estimateCost(pricing: ModelPricing | null | undefined, request: CostRequest): CostEstimate | null {
  if (!pricing) return null;
  const key = pricing.by ? byKey(pricing.by, request.options) : undefined;
  const unit = (pricing.by && key !== undefined ? pricing.by.amounts[key] : undefined) ?? pricing.amount;
  if (unit === undefined) return null;
  const quantity = pricing.per === 'second' ? request.seconds
    : pricing.per === 'output' ? request.outputs ?? 1
    : pricing.per === 'megapixel' ? request.megapixels ?? 1
    : pricing.per === 'character' ? request.characters : 1;
  if (quantity === undefined || quantity === null || !Number.isFinite(quantity) || quantity < 0) return null;
  return { amount: round(Math.max(unit * quantity, pricing.minimum ?? 0), pricing.currency), currency: pricing.currency, basis: pricing.basis };
}

/** Adds estimates per currency; steps without a listed price are counted, never guessed. */
export function sumCosts(estimates: readonly (CostEstimate | null | undefined)[]): CostTotal {
  const totals = new Map<PriceCurrency, CostEstimate>();
  let unpriced = 0;
  for (const estimate of estimates) {
    if (!estimate) { unpriced++; continue; }
    const current = totals.get(estimate.currency);
    totals.set(estimate.currency, { amount: round((current?.amount ?? 0) + estimate.amount, estimate.currency), currency: estimate.currency, basis: current?.basis === 'average' || estimate.basis === 'average' ? 'average' : 'list' });
  }
  return { totals: PRICE_CURRENCIES.flatMap(currency => totals.get(currency) ?? []), unpriced };
}

/** Approximate output size by resolution label, for prices per megapixel. */
const MEGAPIXELS: Record<string, number> = { '480p': 0.41, '720p': 0.92, '768sq': 0.59, '768p': 1.02, '1k': 1.05, '1.5k': 2.36, '1080p': 2.07, '2k': 4.19, '1440p': 3.69, '2160p': 8.29, '4k': 16.78 };
const seconds = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
};

/** What a request asks for: length, script characters, output size and the chosen options. */
export function costRequest(input: { duration?: unknown; defaultDuration?: unknown; sourceSeconds?: number | null; prompt?: unknown; options?: Readonly<Record<string, unknown>> | null; outputs?: number }): CostRequest {
  const resolution = String(input.options?.resolution ?? input.options?.image_size ?? '').toLowerCase();
  return {
    seconds: seconds(input.duration) ?? seconds(input.sourceSeconds) ?? seconds(input.options?.duration) ?? seconds(input.options?.duration_seconds) ?? seconds(input.defaultDuration),
    outputs: input.outputs ?? 1,
    characters: typeof input.prompt === 'string' ? input.prompt.trim().length : null,
    megapixels: MEGAPIXELS[resolution] ?? 1,
    options: input.options ?? null,
  };
}
