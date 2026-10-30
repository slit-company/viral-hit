import { STUDIO_TOOL_IDS, STUDIO_TOOL_KINDS } from '@/core/studio/tools';
import { referenceInputsSchema } from '../reference-inputs';
import { maskInputSchema } from '../mask-input';
import { referenceRolesSchema } from '../reference-roles';
import { modelControlsSchema } from '../model-controls';
import { analysisInputsSchema } from '../analysis-inputs';
import { analysisReport } from '../analysis-report';
import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * provider.json of a generation provider an operator installs without changing the app. The
 * manifest is public metadata; the code lives in the module named by entry and runs on the server.
 */
export const PROVIDER_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9', '9:21', '2:1', '1:2', 'auto'] as const;
const hostname = z.string().regex(/^(?:[a-z0-9-]+\.)*[a-z0-9-]+(?::\d{1,5})?$/, 'Use a host name such as media.example.com or 127.0.0.1:8188');

export const providerModelSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,63}$/, 'Use lowercase letters, numbers, dots and hyphens'),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['image', 'video', 'audio', 'analysis']),
  controls: modelControlsSchema.optional(),
  studioTasks: z.array(z.enum(STUDIO_TOOL_IDS)).min(1).max(8).refine(items => new Set(items).size === items.length).optional(),
  analysisInputs: analysisInputsSchema.optional(),
  referenceInputs: referenceInputsSchema.optional(),
  maskInput: maskInputSchema.optional(),
  /** Specific roles (style, subject, pose) the model understands; delivered to the module as input.references. */
  referenceRoles: referenceRolesSchema.optional(),
  upstreamModelId: z.string().trim().min(1).max(200).optional(),
  aspectRatios: z.array(z.enum(PROVIDER_ASPECT_RATIOS)).max(PROVIDER_ASPECT_RATIOS.length).default([]),
  defaultAspectRatio: z.enum(PROVIDER_ASPECT_RATIOS).optional(),
  durations: z.array(z.string().regex(/^\d{1,2}s$/)).min(1).max(12).optional(),
  defaultDuration: z.string().regex(/^\d{1,2}s$/).optional(),
  maxReferenceImages: z.number().int().min(0).max(30).default(0),
  requiresImageInput: z.boolean().default(false),
}).strict().superRefine((model, ctx) => {
  if (model.studioTasks?.some(task => STUDIO_TOOL_KINDS[task] !== model.kind)) ctx.addIssue({ code: 'custom', message: 'Studio tasks must match the output kind' });
  if ((model.kind === 'image' || model.kind === 'video') && !model.aspectRatios.length) ctx.addIssue({ code: 'custom', message: 'Image/video models require aspectRatios' });
  if (model.kind === 'analysis' && (model.aspectRatios.length || model.maxReferenceImages || model.requiresImageInput)) ctx.addIssue({ code: 'custom', message: 'Analysis uses analysisInputs, with no image-generation or output aspect-ratio settings' });
  if (model.kind === 'audio' && (model.aspectRatios.length || model.maxReferenceImages || model.requiresImageInput)) ctx.addIssue({ code: 'custom', message: 'Audio models use referenceInputs without visual aspect ratios or image-generation settings' });
  if (model.kind === 'analysis' && model.referenceInputs) ctx.addIssue({ code: 'custom', message: 'Analysis uses analysisInputs, not referenceInputs' });
  if (model.referenceInputs && (model.maxReferenceImages || model.requiresImageInput)) ctx.addIssue({ code: 'custom', message: 'Use referenceInputs alone instead of legacy image reference settings' });
  if (model.kind !== 'analysis' && model.analysisInputs) ctx.addIssue({ code: 'custom', message: 'Only analysis models declare analysisInputs' });
  if (model.referenceRoles && model.kind === 'analysis') ctx.addIssue({ code: 'custom', message: 'Analysis models describe sources with analysisInputs, not reference roles' });
  if (model.maskInput && model.kind !== 'image' && model.kind !== 'video') ctx.addIssue({ code: 'custom', message: 'Only image and video models accept a mask' });
  if (model.maskInput && !(model.referenceInputs ? model.referenceInputs.image.max + model.referenceInputs.video.max : model.maxReferenceImages)) ctx.addIssue({ code: 'custom', message: 'A mask needs at least one image or video reference to apply to' });
  if (model.defaultAspectRatio && !model.aspectRatios.includes(model.defaultAspectRatio)) ctx.addIssue({ code: 'custom', message: 'defaultAspectRatio must be one of aspectRatios' });
  if (model.kind !== 'video' && model.durations) ctx.addIssue({ code: 'custom', message: 'Only video models have durations' });
  if (model.defaultDuration && !model.durations?.includes(model.defaultDuration)) ctx.addIssue({ code: 'custom', message: 'defaultDuration must be one of durations' });
  if (model.requiresImageInput && model.maxReferenceImages === 0) ctx.addIssue({ code: 'custom', message: 'A model that requires an image needs maxReferenceImages' });
});

export const providerManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('viral-hit-provider'),
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'Use lowercase letters, numbers and hyphens'),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).optional(),
  /** general: models for any project. specialized: one format, job, audience or brand. */
  scope: z.enum(['general', 'specialized']).default('general'),
  author: z.string().trim().min(1).max(120).optional(),
  license: z.string().trim().min(1).max(80).optional(),
  referenceDelivery: z.literal('project-media').optional(),
  /** Opt in to encrypted workspace settings passed as request.configuration. */
  configurationDelivery: z.literal('request').optional(),
  connectionTest: z.boolean().optional(),
  /** Official page where a user creates the key this provider needs (shown as "Get a key"). */
  setupUrl: z.string().url().max(300).refine(value => value.startsWith('https://'), 'Use an https:// setup URL').optional(),
  /** Short format hint for the key field, for example KEY_ID:KEY_SECRET. Never a real value. */
  keyFormat: z.string().trim().min(1).max(60).optional(),
  entry: z.string().regex(/^[A-Za-z0-9_-]+\.m?js$/).default('provider.mjs'),
  /** Hosts allowed to serve result URLs; plain http is accepted only for localhost and 127.0.0.1. */
  mediaHosts: z.array(hostname).max(20).default([]),
  /** Required server environment variable names; values are never public metadata. */
  environment: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/)).max(32).default([]),
  models: z.array(providerModelSchema).min(1).max(50),
}).strict().superRefine((manifest, ctx) => {
  if (new Set(manifest.environment).size !== manifest.environment.length) ctx.addIssue({ code: 'custom', message: 'Environment variable names must be unique' });
  if (new Set(manifest.models.map(model => model.id)).size !== manifest.models.length) ctx.addIssue({ code: 'custom', message: 'Model ids must be unique' });
});
export type ProviderManifest = z.infer<typeof providerManifestSchema>;
export type ProviderModel = ProviderManifest['models'][number];

/** Stable numeric id stored with each generation, kept clear of built-in model ids. */
export const installedEffectId = (providerId: string, modelId: string) =>
  1_000_000_000 + Number.parseInt(createHash('sha256').update(providerId + '\0' + modelId).digest('hex').slice(0, 7), 16);

const costAmounts = { reserved: z.number().finite().nonnegative().optional(), captured: z.number().finite().nonnegative().optional(), refunded: z.number().finite().nonnegative().optional(), released: z.number().finite().nonnegative().optional() };
/** Public amounts reported by the provider, never a fabricated cost estimate. */
const providerCostSchema = z.object({ state: z.enum(['unknown', 'reserved', 'captured', 'refunded']), final: z.boolean(), unit: z.string().min(1).max(32).optional(), ...costAmounts, usdCents: z.object(costAmounts).strict().optional() }).strict();

/** What a provider module returns from createGeneration and checkStatus. */
export const providerResultSchema = z.object({
  status: z.enum(['succeeded', 'processing', 'pending', 'failed']),
  taskId: z.string().min(1).max(200).optional(),
  cost: providerCostSchema.optional(),
  media: z.array(z.union([
    z.object({ url: z.string().url().max(4096) }).strict(),
    z.object({ data: z.instanceof(Uint8Array), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/aac']) }).strict(),
  ])).max(8).optional(),
  report: analysisReport.optional(),
  text: z.string().trim().min(1).max(128_000).optional(),
  error: z.string().max(1000).optional(),
}).strict().superRefine((result, ctx) => {
  if (result.status === 'succeeded' && !result.media?.length && !result.text && !result.report) ctx.addIssue({ code: 'custom', message: 'A succeeded result needs media or analysis text' });
  if (result.report && result.status !== 'succeeded') ctx.addIssue({ code: 'custom', message: 'Structured reports require succeeded status' });
  if ((result.status === 'processing' || result.status === 'pending') && !result.taskId) ctx.addIssue({ code: 'custom', message: 'An unfinished result needs a taskId to check later' });
});
export type ProviderResult = z.infer<typeof providerResultSchema>;
