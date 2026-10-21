import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getViralHitDataRoot } from '../src/config/data-root';
import { writeTar } from '../src/core/projects/bundles/tar.server';
import { validateCreativeManifest } from '../src/core/creative-packs/manifest.server';

const skill = JSON.parse(await readFile('skills/official/consistent-characters/skill.json', 'utf8'));
Object.assign(skill, { id: 'community-planning', title: 'Community shot planning', author: 'Community studio', summary: 'Plan an editable visual sequence for any project.' });
const manifest = validateCreativeManifest({
  schemaVersion: 1, kind: 'viral-hit-creative-pack', id: 'community-toolkit', version: '1.0.0',
  title: 'Community creative toolkit', description: 'A general toolkit shared through an independent repository.',
  author: 'Community studio', license: 'Apache-2.0', scope: 'general', useCases: ['creative-work'],
  recipes: [], characters: [], skills: [{ schemaVersion: 1, kind: 'viral-hit-skill', manifest: skill,
    instructions: '# Community planning\n\nInspect the current project, prepare separate shots and keep them editable. Do not generate or publish without the user request.\n' }],
});
const file = await open(join(getViralHitDataRoot(), 'shared-creative-pack.tar'), 'wx', 0o600);
try { await writeTar(file, Buffer.from(JSON.stringify(manifest)), [], AbortSignal.timeout(30_000)); }
finally { await file.close(); }
