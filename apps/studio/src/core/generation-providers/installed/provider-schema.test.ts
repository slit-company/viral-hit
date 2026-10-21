import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020';
import { z } from 'zod';
import { installedEffectId, providerManifestSchema } from './manifest';

const schemaFile = '../../docs/schemas/provider.schema.json';

test('the published provider.json schema matches the runtime contract and accepts the example', async () => {
  const published = JSON.parse(await readFile(schemaFile, 'utf8'));
  assert.deepEqual(published, JSON.parse(JSON.stringify(z.toJSONSchema(providerManifestSchema, { io: 'input' }))), 'Regenerate with: pnpm provider schema ../../docs/schemas/provider.schema.json');
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(published);
  const example = JSON.parse(await readFile('../../examples/providers/procedural-images/provider.json', 'utf8')) as { models: Record<string, unknown>[] } & Record<string, unknown>;
  assert.ok(validate(example), JSON.stringify(validate.errors?.slice(0, 3)));
  assert.equal(validate({ ...example, scope: 'everyone' }), false);
  assert.equal(validate({ ...example, entry: '../escape.mjs' }), false);
  assert.throws(() => providerManifestSchema.parse({ ...example, models: [{ ...example.models[0], defaultAspectRatio: '21:9' }] }), /defaultAspectRatio/);
});

test('installed model ids map to stable numbers outside the built-in range', () => {
  const id = installedEffectId('procedural-images', 'procedural-gradient');
  assert.equal(id, installedEffectId('procedural-images', 'procedural-gradient'));
  assert.notEqual(id, installedEffectId('procedural-images', 'procedural-gradient-queued'));
  assert.ok(id >= 1_000_000_000 && Number.isSafeInteger(id));
});
