import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

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

/** official: bundled and evaluated with Viral Hit. local: installed by the operator from VIRAL_HIT_SKILLS_DIR. */
export type ViralHitSkillSource = 'official' | 'local';

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

/** A local skill that could not be loaded; the rest of the catalog still works. */
export type ViralHitSkillProblem = { source: ViralHitSkillSource; location: string; message: string };

export type ViralHitSkillCatalog = {
  schemaVersion: typeof VIRAL_HIT_SKILL_SCHEMA_VERSION;
  viralHitVersion: string;
  skills: ViralHitSkillDescriptor[];
  problems: ViralHitSkillProblem[];
};

const problemMessage = (error: unknown) =>
  (error instanceof z.ZodError
    ? error.issues.slice(0, 4).map((issue) => (issue.path.length ? issue.path.join('.') + ': ' : '') + issue.message).join('; ')
    : error instanceof Error ? error.message : 'Unreadable skill').slice(0, 500);

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
  problems: loadProblems = [],
}: {
  definitions: readonly ViralHitSkillDefinition[];
  viralHitVersion: string;
  availableMcpTools: readonly string[];
  problems?: readonly ViralHitSkillProblem[];
}) {
  semanticVersionSchema.parse(viralHitVersion);
  const availableTools = new Set(availableMcpTools);
  const problems = [...loadProblems];
  const build = (definition: ViralHitSkillDefinition): ViralHitSkill => {
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
      source: definition.source ?? 'official',
      resourceUri: buildViralHitSkillResourceUri(manifest.id),
      compatible: incompatibilities.length === 0,
      incompatibilities,
    };
  };

  // Official skills must be valid and unique; a local skill that fails is reported and left out.
  const byId = new Map<string, ViralHitSkill>();
  for (const definition of definitions) {
    const source = definition.source ?? 'official';
    let skill: ViralHitSkill;
    try {
      skill = build(definition);
    } catch (error) {
      if (source === 'official') throw error;
      problems.push({ source, location: String(definition.manifest?.id ?? 'unknown'), message: problemMessage(error) });
      continue;
    }
    const existing = byId.get(skill.manifest.id);
    if (existing && source === 'official' && existing.source === 'official') {
      throw new Error(`Duplicate ViralHit Skill id: ${skill.manifest.id}`);
    }
    if (existing) {
      problems.push({ source, location: skill.manifest.id, message: `Skill id ${skill.manifest.id} is already provided by the ${existing.source} skill.` });
      continue;
    }
    byId.set(skill.manifest.id, skill);
  }
  const skills = [...byId.values()];

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
      problems,
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

/** Reads one skill folder: skill.json plus SKILL.md, with the folder name equal to the skill id. */
export async function readViralHitSkillDirectory(skillDirectory: string, source: ViralHitSkillSource = 'official'): Promise<ViralHitSkillDefinition> {
  const [manifestText, instructions] = await Promise.all([
    readBoundedTextFile(resolve(skillDirectory, 'skill.json'), MAX_MANIFEST_BYTES),
    readBoundedTextFile(resolve(skillDirectory, 'SKILL.md'), MAX_INSTRUCTIONS_BYTES),
  ]);
  const manifest = viralHitSkillManifestSchema.parse(JSON.parse(manifestText) as unknown);
  const name = basename(skillDirectory);
  if (manifest.id !== name) {
    throw new Error(`ViralHit Skill directory ${name} must match manifest id ${manifest.id}.`);
  }
  return { manifest, instructions, source };
}

async function readSkillRoot(directory: string, source: ViralHitSkillSource, problems: ViralHitSkillProblem[]) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (source === 'local') problems.push({ source, location: basename(directory), message: 'Skills folder not found.' });
    return [];
  }
  const folders = entries.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name));
  const read = await Promise.all(folders.map(async (entry) => {
    try {
      return await readViralHitSkillDirectory(resolve(directory, entry.name), source);
    } catch (error) {
      if (source === 'official') throw error;
      problems.push({ source, location: entry.name, message: problemMessage(error) });
      return null;
    }
  }));
  return read.filter((definition): definition is ViralHitSkillDefinition => definition !== null);
}

/**
 * Loads bundled official skills and, when configured, the operator's own skills folder.
 * Official skills win on id conflicts; problems with local skills are listed in the catalog.
 */
export async function loadViralHitSkillRegistry({
  directory,
  localDirectory,
  viralHitVersion,
  availableMcpTools,
}: {
  directory: string;
  localDirectory?: string;
  viralHitVersion: string;
  availableMcpTools: readonly string[];
}) {
  const problems: ViralHitSkillProblem[] = [];
  const official = await readSkillRoot(directory, 'official', problems);
  const local = localDirectory ? await readSkillRoot(localDirectory, 'local', problems) : [];
  return createViralHitSkillRegistry({ definitions: [...official, ...local], viralHitVersion, availableMcpTools, problems });
}
