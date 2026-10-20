import { z } from 'zod';

/**
 * A pack groups recipes for one way of working. "general" packs serve any
 * project; "specialized" packs encode a particular format, job or audience.
 * Both install through the same reviewed, immutable recipe library.
 */
export const MAX_PACK_BYTES = 1_000_000;
export const MAX_PACK_RECIPES = 24;
const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
const httpsUrl = z.string().url().max(300).refine(value => value.startsWith('https://'), 'Use an HTTPS link');

export const packScopes = ['general', 'specialized'] as const;
export const packManifestSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('viral-hit-pack'),
  id: identifier.refine(value => value.length <= 40, 'Pack IDs are at most 40 characters'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string().min(1).max(120), description: z.string().min(1).max(2000),
  author: z.string().min(1).max(120), license: z.string().min(1).max(100),
  scope: z.enum(packScopes), useCases: z.array(identifier).min(1).max(8),
  homepage: httpsUrl.optional(),
  recipes: z.array(z.unknown()).min(1).max(MAX_PACK_RECIPES),
}).strict();
export type PackManifest = z.infer<typeof packManifestSchema>;
export type PackScope = (typeof packScopes)[number];

/** Pack metadata kept with an installation; the recipes live in the recipe table. */
export const packSummarySchema = packManifestSchema.omit({ recipes: true }).extend({
  recipeIds: z.array(identifier).min(1).max(MAX_PACK_RECIPES), digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PackSummary = z.infer<typeof packSummarySchema>;
export type InstalledPack = PackSummary & { installedAt: number };
export type PackCatalog = {
  installed: InstalledPack[];
  available: { manifest: unknown; summary: PackSummary; state: 'available' | 'installed' | 'other-version' }[];
};

export type PackRecipeReview = {
  id: string; title: string; description: string; category: string;
  collision: 'none' | 'same' | 'different' | 'reserved';
  operations: string[]; unavailableOperations: string[]; parameterCount: number;
};
export type PackInspection = {
  pack: PackSummary; collision: 'none' | 'same' | 'different';
  recipes: PackRecipeReview[]; operations: string[]; unavailableOperations: string[];
  /** Reasons the pack cannot be installed as reviewed; empty means installable. */
  blocking: string[];
};
