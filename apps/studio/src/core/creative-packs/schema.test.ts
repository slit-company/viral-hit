import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv from 'ajv';
import { z } from 'zod';
import { creativePackManifestSchema } from './contract';

test('the published creative pack author schema matches runtime and supports general and specialized packs', async () => {
  const published = JSON.parse(await readFile('../../docs/schemas/creative-pack.schema.json', 'utf8'));
  assert.deepEqual(published, z.toJSONSchema(creativePackManifestSchema, { io: 'input' }));
  const schema = structuredClone(published); delete schema.$schema;
  const validate = new Ajv({ strict: false, validateFormats: false }).compile(schema);
  const skill = { schemaVersion: 1, kind: 'viral-hit-skill', manifest: JSON.parse(await readFile('skills/official/consistent-characters/skill.json', 'utf8')), instructions: await readFile('skills/official/consistent-characters/SKILL.md', 'utf8') };
  for (const scope of ['general', 'specialized']) assert.equal(validate({ schemaVersion: 1, kind: 'viral-hit-creative-pack', id: 'example-kit', version: '1.0.0', title: 'Example kit', description: 'A toolkit for making things', author: 'Contributor', license: 'Apache-2.0', scope, useCases: ['stories'], recipes: [], skills: [skill], characters: [] }), true, JSON.stringify(validate.errors));
  assert.equal(creativePackManifestSchema.safeParse({ schemaVersion: 1, kind: 'viral-hit-creative-pack', id: 'empty-kit', version: '1.0.0', title: 'Empty kit', description: 'No contents', author: 'Contributor', license: 'Apache-2.0', scope: 'general', useCases: ['stories'], recipes: [], skills: [], characters: [] }).success, false);
});
