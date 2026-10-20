import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as z from 'zod/v4';
import { createViralHitSkillRegistry, loadViralHitSkillRegistry, readViralHitSkillDirectory, viralHitSkillManifestSchema } from '../src/core/skills/skill-registry';
import { VIRAL_HIT_MCP_TOOL_NAMES } from '../src/mcp/tools';
import { version } from '../package.json';

// Usage: pnpm skill list | check <skill-folder> | schema <out.json>
// list shows official skills and those in VIRAL_HIT_SKILLS_DIR; check validates one folder before you share or install it.
const [command, target] = process.argv.slice(2);
const options = { viralHitVersion: version, availableMcpTools: VIRAL_HIT_MCP_TOOL_NAMES };
try {
  if (command === 'list') {
    const catalog = (await loadViralHitSkillRegistry({ directory: resolve('skills/official'), localDirectory: process.env.VIRAL_HIT_SKILLS_DIR?.trim() || undefined, ...options })).catalog();
    for (const skill of catalog.skills) console.log([skill.manifest.id, skill.source, skill.manifest.scope, skill.compatible ? 'compatible' : 'incompatible: ' + skill.incompatibilities.join(' ')].join('\t'));
    for (const problem of catalog.problems) console.log(['problem', problem.source, problem.location, problem.message].join('\t'));
  } else if (command === 'check' && target) {
    const definition = await readViralHitSkillDirectory(resolve(target), 'local');
    const [skill] = createViralHitSkillRegistry({ definitions: [definition], ...options }).list();
    const { id, title, scope, author, license } = skill.manifest;
    console.log(JSON.stringify({ id, title, scope, author: author ?? null, license: license ?? null, compatible: skill.compatible, incompatibilities: skill.incompatibilities }, null, 2));
    if (!skill.compatible) process.exitCode = 1;
  } else if (command === 'schema' && target) {
    // Describes what authors write, so defaulted fields stay optional.
    await writeFile(resolve(target), JSON.stringify(z.toJSONSchema(viralHitSkillManifestSchema, { io: 'input' }), null, 2) + '\n', { flag: 'wx' });
  } else {
    throw new Error('Usage: skill list | check <skill-folder> | schema <out.json>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Skill command failed');
  process.exitCode = 1;
}
