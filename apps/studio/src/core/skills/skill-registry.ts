import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import * as z from 'zod/v4';

export * from './contract';
import { MAX_MANIFEST_BYTES, MAX_INSTRUCTIONS_BYTES, VIRAL_HIT_SKILL_CATALOG_URI, VIRAL_HIT_SKILL_SCHEMA_VERSION, viralHitSkillManifestSchema, type ViralHitSkill, type ViralHitSkillCatalog, type ViralHitSkillDefinition, type ViralHitSkillDescriptor, type ViralHitSkillProblem, type ViralHitSkillSource } from './contract';

const semanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

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
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size > maxBytes) throw new Error('Invalid or oversized skill file');
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

async function readSkillRoot(directory: string, source: ViralHitSkillSource, problems: ViralHitSkillProblem[], excluded = new Set<string>()) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (source === 'local') problems.push({ source, location: basename(directory), message: 'Skills folder not found.' });
    return [];
  }
  const folders = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !excluded.has(entry.name)).sort((left, right) => left.name.localeCompare(right.name));
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
  installedDirectory,
  installedOverrides = [],
  viralHitVersion,
  availableMcpTools,
}: {
  directory: string;
  localDirectory?: string;
  installedDirectory?: string;
  installedOverrides?: readonly { id: string; definition: ViralHitSkillDefinition | null }[];
  viralHitVersion: string;
  availableMcpTools: readonly string[];
}) {
  const problems: ViralHitSkillProblem[] = [];
  const official = await readSkillRoot(directory, 'official', problems);
  const local = localDirectory ? await readSkillRoot(localDirectory, 'local', problems) : [];
  const installed = installedDirectory ? await readSkillRoot(installedDirectory, 'installed', problems, new Set(installedOverrides.map(row => row.id))) : [];
  for (const row of installedOverrides) if (row.definition) installed.push(row.definition);
  return createViralHitSkillRegistry({ definitions: [...official, ...local, ...installed], viralHitVersion, availableMcpTools, problems });
}
