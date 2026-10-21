import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import * as z from 'zod/v4';
import { viralHitSkillManifestSchema } from './skill-registry';
import { skillPackageSchema } from './package';

const schemaFile = '../../docs/schemas/skill.schema.json';

test('the published skill.json schema matches the runtime contract and accepts every shipped skill', async () => {
  const published = JSON.parse(await readFile(schemaFile, 'utf8'));
  assert.deepEqual(published, JSON.parse(JSON.stringify(z.toJSONSchema(viralHitSkillManifestSchema, { io: 'input' }))), 'Regenerate with: pnpm skill schema ../../docs/schemas/skill.schema.json');
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(published);
  const roots = ['skills/official', '../../examples/skills'];
  let checked = 0;
  for (const root of roots) for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(await readFile(join(root, entry.name, 'skill.json'), 'utf8'));
    assert.ok(validate(manifest), entry.name + ': ' + JSON.stringify(validate.errors?.slice(0, 3)));
    checked++;
  }
  assert.equal(checked, 4);
  const official = JSON.parse(await readFile('skills/official/recipe-packs/skill.json', 'utf8'));
  assert.equal(validate({ ...official, scope: 'everyone' }), false);
});

test('the portable skill file schema matches the runtime and preserves complete instructions', async () => {
  const published = JSON.parse(await readFile('../../docs/schemas/skill-file.schema.json', 'utf8'));
  assert.deepEqual(published, JSON.parse(JSON.stringify(z.toJSONSchema(skillPackageSchema, { io: 'input' }))));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(published);
  const manifest = JSON.parse(await readFile('../../examples/skills/product-ad-shots/skill.json', 'utf8'));
  const instructions = await readFile('../../examples/skills/product-ad-shots/SKILL.md', 'utf8');
  const file = { schemaVersion: 1, kind: 'viral-hit-skill', manifest, instructions };
  assert.equal(validate(file), true);
  assert.equal(validate({ ...file, instructions: '' }), false);
  assert.equal(validate({ ...file, entry: 'run.sh' }), false);
});
