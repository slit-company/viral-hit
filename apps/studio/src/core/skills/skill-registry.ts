import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import * as z from 'zod/v4';

export const VIRAL_HIT_SKILL_SCHEMA_VERSION = 1;
export const VIRAL_HIT_SKILL_CATALOG_URI = 'viral-hit://skills';
export const VIRAL_HIT_SKILL_RESOURCE_TEMPLATE =
  'viral-hit://skills/{skillId}';

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_INSTRUCTIONS_BYTES = 512 * 1024;

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

export type ViralHitSkillDefinition = {
  manifest: ViralHitSkillManifest;
  instructions: string;
};

export type ViralHitSkill = ViralHitSkillDefinition & {
  resourceUri: string;
  compatible: boolean;
  incompatibilities: string[];
};

export type ViralHitSkillDescriptor = Omit<ViralHitSkill, 'instructions'>;

export type ViralHitSkillCatalog = {
  schemaVersion: typeof VIRAL_HIT_SKILL_SCHEMA_VERSION;
  viralHitVersion: string;
  skills: ViralHitSkillDescriptor[];
};

const parseVersion = (value: string) =>
  value
    .split('-', 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10)) as [number, number, number];

export const isViralHitVersionCompatible = (
  currentVersion: string,
  minimumVersion: string
) => {
  const current = parseVersion(currentVersion);
  const minimum = parseVersion(minimumVersion);
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
};

export const buildViralHitSkillResourceUri = (skillId: string) =>
  `${VIRAL_HIT_SKILL_CATALOG_URI}/${encodeURIComponent(skillId)}`;

export function createViralHitSkillRegistry({
  definitions,
  viralHitVersion,
  availableMcpTools,
}: {
  definitions: readonly ViralHitSkillDefinition[];
  viralHitVersion: string;
  availableMcpTools: readonly string[];
}) {
  semanticVersionSchema.parse(viralHitVersion);
  const availableTools = new Set(availableMcpTools);
  const skills = definitions.map((definition) => {
    const manifest = viralHitSkillManifestSchema.parse(definition.manifest);
    const instructions = z
      .string()
      .trim()
      .min(1)
      .max(MAX_INSTRUCTIONS_BYTES)
      .parse(definition.instructions);
    const incompatibilities: string[] = [];
    if (
      !isViralHitVersionCompatible(
        viralHitVersion,
        manifest.compatibility.minimumViralHitVersion
      )
    ) {
      incompatibilities.push(
        `Requires ViralHit ${manifest.compatibility.minimumViralHitVersion} or newer.`
      );
    }
    const missingTools = manifest.compatibility.requiredMcpTools.filter(
      (tool) => !availableTools.has(tool)
    );
    if (missingTools.length > 0) {
      incompatibilities.push(`Missing MCP tools: ${missingTools.join(', ')}.`);
    }
    return {
      manifest,
      instructions,
      resourceUri: buildViralHitSkillResourceUri(manifest.id),
      compatible: incompatibilities.length === 0,
      incompatibilities,
    } satisfies ViralHitSkill;
  });

  const byId = new Map<string, ViralHitSkill>();
  for (const skill of skills) {
    if (byId.has(skill.manifest.id)) {
      throw new Error(`Duplicate ViralHit Skill id: ${skill.manifest.id}`);
    }
    byId.set(skill.manifest.id, skill);
  }

  const ordered = [...skills].sort((left, right) =>
    left.manifest.id.localeCompare(right.manifest.id)
  );

  return {
    list: (): ViralHitSkillDescriptor[] =>
      ordered.map(({ instructions: _instructions, ...descriptor }) => descriptor),
    get: (skillId: string): ViralHitSkill | null => byId.get(skillId) ?? null,
    catalog: (): ViralHitSkillCatalog => ({
      schemaVersion: VIRAL_HIT_SKILL_SCHEMA_VERSION,
      viralHitVersion,
      skills: ordered.map(({ instructions: _instructions, ...descriptor }) =>
        descriptor
      ),
    }),
  };
}

const readBoundedTextFile = async (path: string, maxBytes: number) => {
  const contents = await readFile(path);
  if (contents.byteLength > maxBytes) {
    throw new Error(`ViralHit Skill file is too large: ${path}`);
  }
  return contents.toString('utf8');
};

export async function loadViralHitSkillRegistry({
  directory,
  viralHitVersion,
  availableMcpTools,
}: {
  directory: string;
  viralHitVersion: string;
  availableMcpTools: readonly string[];
}) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createViralHitSkillRegistry({
        definitions: [],
        viralHitVersion,
        availableMcpTools,
      });
    }
    throw error;
  }

  const definitions = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const skillDirectory = resolve(directory, entry.name);
        const [manifestText, instructions] = await Promise.all([
          readBoundedTextFile(
            resolve(skillDirectory, 'skill.json'),
            MAX_MANIFEST_BYTES
          ),
          readBoundedTextFile(
            resolve(skillDirectory, 'SKILL.md'),
            MAX_INSTRUCTIONS_BYTES
          ),
        ]);
        const manifest = viralHitSkillManifestSchema.parse(
          JSON.parse(manifestText) as unknown
        );
        if (manifest.id !== entry.name) {
          throw new Error(
            `ViralHit Skill directory ${entry.name} must match manifest id ${manifest.id}.`
          );
        }
        return { manifest, instructions };
      })
  );

  return createViralHitSkillRegistry({
    definitions,
    viralHitVersion,
    availableMcpTools,
  });
}
