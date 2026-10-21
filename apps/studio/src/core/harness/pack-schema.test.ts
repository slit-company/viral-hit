import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { z } from 'zod';
import { MAX_PACK_RECIPES, packManifestSchema } from './recipe-packs';
import { recipeSchema } from './recipes';

const schemaFile = '../../docs/schemas/pack.schema.json';
// Schemas describe what authors write, so defaulted fields stay optional.
const generated = () => z.toJSONSchema(packManifestSchema.extend({ recipes: z.array(recipeSchema).min(1).max(MAX_PACK_RECIPES) }), { io: 'input' });

test('the published pack JSON Schema matches the runtime contract', async () => {
  assert.deepEqual(JSON.parse(await readFile(schemaFile, 'utf8')), JSON.parse(JSON.stringify(generated())), 'Regenerate with: pnpm recipe pack-schema ../../docs/schemas/pack.schema.json');
});

test('the published recipe and sequence schemas match the runtime contracts', async () => {
  const { sequenceSchema } = await import('../editor/sequence');
  for (const [file, schema] of [['recipe', recipeSchema], ['sequence', sequenceSchema]] as const) {
    assert.deepEqual(JSON.parse(await readFile('../../docs/schemas/' + file + '.schema.json', 'utf8')), JSON.parse(JSON.stringify(z.toJSONSchema(schema, { io: 'input' }))), 'Regenerate docs/schemas/' + file + '.schema.json');
  }
});

test('every bundled and extension pack validates against the published schema', async () => {
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(await readFile(schemaFile, 'utf8')));
  const files = [
    ...(await readdir('../../packs')).filter(name => name.endsWith('.json')).map(name => join('../../packs', name)),
    ...(await readdir('../../extensions', { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => join('../../extensions', entry.name, 'pack.json')),
  ];
  let checked = 0;
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text === null) continue;
    assert.ok(validate(JSON.parse(text)), file + ': ' + JSON.stringify(validate.errors?.slice(0, 3)));
    checked++;
  }
  assert.equal(checked, 5);
  assert.equal(validate({ schemaVersion: 1, kind: 'viral-hit-pack', id: 'x', version: '1.0.0', title: 't', description: 'd', author: 'a', license: 'l', scope: 'everyone', useCases: ['u'], recipes: [] }), false);
});

test('every recipe file shipped in the repository validates against the published recipe schema', async () => {
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(await readFile('../../docs/schemas/recipe.schema.json', 'utf8')));
  const directories = ['../../recipes', '../../examples/adapter-recipes', '../../extensions/ima2/recipes', '../../extensions/local-media/recipes', '../../extensions/whisper/recipes'];
  let checked = 0;
  for (const directory of directories) for (const name of (await readdir(directory)).filter(file => file.endsWith('.json'))) {
    const recipe = JSON.parse(await readFile(join(directory, name), 'utf8'));
    assert.ok(validate(recipe), directory + '/' + name + ': ' + JSON.stringify(validate.errors?.slice(0, 3)));
    checked++;
  }
  assert.ok(checked >= 20, 'checked ' + checked);
});
