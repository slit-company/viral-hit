import assert from 'node:assert/strict';
import test from 'node:test';
import { listGenerationProviders as listMetadata, registerGenerationProviderMetadata } from '../generation-providers/catalog';
import { listGenerationProviders, registerGenerationProvider, getGenerationProvider } from '../generation-providers/registry';
import { MockAdapter } from '../adapters/mock-adapter';

test('public provider catalog is serializable metadata matching server execution', () => {
  const metadata = listMetadata();
  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), metadata);
  for (const definition of listGenerationProviders()) {
    const item = metadata.find(value => value.id === definition.id);
    assert.deepEqual(item, {
      id: definition.id, label: definition.label,
      supports: definition.supports, modelBindings: definition.modelBindings,
    });
    assert.equal('createAdapter' in item!, false);
    assert.equal('assertConfigured' in item!, false);
  }
});

test('source extensions must agree with their public catalog before execution', () => {
  const metadata = { id: 'boundary-test', label: 'Boundary test', supports: ['image'] as const, modelBindings: [] };
  const definition = { ...metadata, createAdapter: (effect: ConstructorParameters<typeof MockAdapter>[0]) => new MockAdapter(effect) };
  assert.throws(() => registerGenerationProvider(definition), /matching public metadata/);
  registerGenerationProviderMetadata(metadata);
  assert.throws(() => registerGenerationProvider({ ...definition, label: 'Different label' }), /matching public metadata/);
  registerGenerationProvider(definition);
  assert.equal(getGenerationProvider(metadata.id)?.createAdapter, definition.createAdapter);
});
