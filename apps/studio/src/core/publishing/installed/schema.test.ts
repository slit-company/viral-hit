import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020';
import { z } from 'zod';
import { connectorManifestSchema, publicConnectorDeliverySchema } from './contract';

test('the published publishing connector schema agrees with runtime and accepts the independently shipped example', async () => {
  const schema = JSON.parse(await readFile('../../docs/schemas/publishing-connector.schema.json', 'utf8'));
  assert.deepEqual(schema, JSON.parse(JSON.stringify(z.toJSONSchema(connectorManifestSchema, { io: 'input' }))));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const manifest = JSON.parse(await readFile('../../examples/publishing-connectors/local-archive/connector.json', 'utf8'));
  assert.equal(validate(manifest), true);
  assert.equal(validate({ ...manifest, scope: 'anything' }), false);
  assert.equal(connectorManifestSchema.safeParse({ ...manifest, id: 'youtube' }).success, false);
  assert.equal(connectorManifestSchema.safeParse({ ...manifest, destinations: [...manifest.destinations, ...manifest.destinations] }).success, false);
  assert.equal(connectorManifestSchema.safeParse({ ...manifest, metadataSchema: { type: 'object', $async: true } }).success, false);
});


test('public connector receipts permit explicit post IDs and HTTPS links, never arbitrary raw fields or script URLs', () => {
  assert.equal(publicConnectorDeliverySchema.safeParse({ id: 'post-1', url: 'https://example.com/posts/1' }).success, true);
  assert.equal(publicConnectorDeliverySchema.safeParse({ id: 'post-1', token: 'private' }).success, false);
  for (const url of ['javascript:alert(1)', 'file:///tmp/private', 'https://token:secret@example.com']) assert.equal(publicConnectorDeliverySchema.safeParse({ id: 'post-1', url }).success, false);
});
