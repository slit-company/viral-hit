import * as z from 'zod/v4';

export const VIRAL_HIT_SKILL_SCHEMA_VERSION = 1;
export const VIRAL_HIT_SKILL_CATALOG_URI = 'viral-hit://skills';
export const VIRAL_HIT_SKILL_RESOURCE_TEMPLATE =
  'viral-hit://skills/{skillId}';

export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_INSTRUCTIONS_BYTES = 512 * 1024;

export const viralHitSkillIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const semanticVersionSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

const skillInputSchema = z
  .object({
    id: viralHitSkillIdSchema,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    kind: z.enum(['text', 'image', 'video', 'audio', 'number', 'boolean']),
    required: z.boolean().default(true),
  })
  .strict();

const skillStageSchema = z
  .object({
    id: viralHitSkillIdSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    reviewRequired: z.boolean().default(false),
  })
  .strict();

export const viralHitSkillManifestSchema = z
  .object({
    schemaVersion: z.literal(VIRAL_HIT_SKILL_SCHEMA_VERSION),
    id: viralHitSkillIdSchema,
    version: semanticVersionSchema,
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(500),
    /** general: helps any project. specialized: one format, job, audience or brand. */
    scope: z.enum(['general', 'specialized']).default('general'),
    author: z.string().trim().min(1).max(120).optional(),
    license: z.string().trim().min(1).max(80).optional(),
    visibility: z.enum(['showcase', 'hidden']).default('showcase'),
    compatibility: z
      .object({
        minimumViralHitVersion: semanticVersionSchema,
        requiredMcpTools: z
          .array(z.string().regex(/^viral_hit_[a-z0-9_]+$/))
          .max(100)
          .default([]),
      })
      .strict(),
    requiredCapabilities: z
      .array(viralHitSkillIdSchema)
      .max(50)
      .default([]),
    inputs: z.array(skillInputSchema).max(32).default([]),
    stages: z.array(skillStageSchema).max(32).default([]),
    showcase: z
      .object({
        category: viralHitSkillIdSchema,
        tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
        featured: z.boolean().default(false),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ViralHitSkillManifest = z.infer<
  typeof viralHitSkillManifestSchema
>;

/** official: bundled/evaluated. local: operator folder. installed: a reviewed portable file. */
export type ViralHitSkillSource = 'official' | 'local' | 'installed';

/** Unparsed input: defaults such as scope general are applied when the registry is built. */
export type ViralHitSkillDefinition = {
  manifest: z.input<typeof viralHitSkillManifestSchema>;
  instructions: string;
  source?: ViralHitSkillSource;
};

export type ViralHitSkill = {
  manifest: ViralHitSkillManifest;
  instructions: string;
  source: ViralHitSkillSource;
  resourceUri: string;
  compatible: boolean;
  incompatibilities: string[];
};

export type ViralHitSkillDescriptor = Omit<ViralHitSkill, 'instructions'>;

/** A local or installed skill that could not be loaded; the rest of the catalog still works. */
export type ViralHitSkillProblem = { source: ViralHitSkillSource; location: string; message: string };

export type ViralHitSkillCatalog = {
  schemaVersion: typeof VIRAL_HIT_SKILL_SCHEMA_VERSION;
  viralHitVersion: string;
  skills: ViralHitSkillDescriptor[];
  problems: ViralHitSkillProblem[];
};
