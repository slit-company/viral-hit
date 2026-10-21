import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as z from 'zod/v4';
import { createViralHitSkillRegistry, readViralHitSkillDirectory, viralHitSkillManifestSchema } from '../src/core/skills/skill-registry';
import { changeSkillLibrary, getSkillRegistry, validateSkillFile } from '../src/core/skills/library.server';
import { skillPackageSchema } from '../src/core/skills/package';
import { VIRAL_HIT_MCP_TOOL_NAMES } from '../src/mcp/tools';
import { version } from '../package.json';

// Folder validation, portable files and installation share the same application contract as UI/MCP.
const [command, target, extra, installedDigest] = process.argv.slice(2);
const options = { viralHitVersion: version, availableMcpTools: VIRAL_HIT_MCP_TOOL_NAMES };
try {
  if (command === 'list') {
    const catalog = (await getSkillRegistry()).catalog();
    for (const skill of catalog.skills) console.log([skill.manifest.id, skill.source, skill.manifest.scope, skill.compatible ? 'compatible' : 'incompatible: ' + skill.incompatibilities.join(' ')].join('\t'));
    for (const problem of catalog.problems) console.log(['problem', problem.source, problem.location, problem.message].join('\t'));
  } else if (command === 'check' && target) {
    const definition = await readViralHitSkillDirectory(resolve(target), 'local');
    const [skill] = createViralHitSkillRegistry({ definitions: [definition], ...options }).list();
    const { id, title, scope, author, license } = skill.manifest;
    console.log(JSON.stringify({ id, title, scope, author: author ?? null, license: license ?? null, compatible: skill.compatible, incompatibilities: skill.incompatibilities }, null, 2));
    if (!skill.compatible) process.exitCode = 1;
  } else if (command === 'pack' && target && extra) {
    const definition = await readViralHitSkillDirectory(resolve(target), 'local');
    const file = validateSkillFile({ schemaVersion: 1, kind: 'viral-hit-skill', manifest: definition.manifest, instructions: definition.instructions });
    await writeFile(resolve(extra), JSON.stringify(file, null, 2) + '\n', { flag: 'wx' });
  } else if (command === 'export' && target && extra) {
    const file = await changeSkillLibrary({ action: 'export', skillId: target });
    await writeFile(resolve(extra), JSON.stringify(file, null, 2) + '\n', { flag: 'wx' });
  } else if ((command === 'review-remove' || command === 'remove') && target) {
    if (command === 'remove' && !extra) throw new Error('Review removal first, then supply its digest.');
    console.log(JSON.stringify(await changeSkillLibrary(command === 'review-remove' ? { action: command, skillId: target } : { action: command, skillId: target, expectedDigest: extra }), null, 2));
  } else if (command === 'update' && target && extra && installedDigest) {
    const file = JSON.parse(await readFile(resolve(target), 'utf8'));
    console.log(JSON.stringify(await changeSkillLibrary({ action: 'update', file, expectedDigest: extra, expectedInstalledDigest: installedDigest }), null, 2));
  } else if ((command === 'inspect' || command === 'install') && target) {
    const file = JSON.parse(await readFile(resolve(target), 'utf8'));
    if (command === 'install' && !extra) throw new Error('Inspect the file first, then supply its digest: skill install <file> <digest>');
    console.log(JSON.stringify(await changeSkillLibrary(command === 'inspect' ? { action: 'inspect', file } : { action: 'install', file, expectedDigest: extra }), null, 2));
  } else if ((command === 'schema' || command === 'file-schema') && target) {
    // Describes what authors write, so defaulted fields stay optional.
    await writeFile(resolve(target), JSON.stringify(z.toJSONSchema(command === 'schema' ? viralHitSkillManifestSchema : skillPackageSchema, { io: 'input' }), null, 2) + '\n', { flag: 'wx' });
  } else {
    throw new Error('Usage: skill list | check <folder> | pack <folder> <out.json> | inspect <file> | install <file> <digest> | update <file> <incoming-digest> <installed-digest> | review-remove <id> | remove <id> <digest> | export <id> <out.json> | schema <out.json> | file-schema <out.json>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Skill command failed');
  process.exitCode = 1;
}
