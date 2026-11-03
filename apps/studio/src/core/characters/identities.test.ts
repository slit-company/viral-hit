import test from 'node:test';
import assert from 'node:assert/strict';
import { identitySuggestions } from './identities';

test('a model setting offers finished identities of its family and version, named by character', () => {
  const soul = (referenceId: string, extra = {}) => ({ provider: 'higgsfield-soul', referenceId, ...extra });
  const characters = [
    { name: 'Mina', status: 'active' as const, providerIdentities: [soul('v2-ready', { version: 'v2', status: 'ready' as const, label: 'Soul ID · Soul 2' }), soul('cinema', { version: 'cinema', status: 'ready' as const }), soul('training', { version: 'v2', status: 'training' as const })] },
    { name: 'Jun', status: 'active' as const, providerIdentities: [soul('pasted')] },
    { name: 'Old', status: 'archived' as const, providerIdentities: [soul('archived')] },
  ];
  assert.deepEqual(identitySuggestions(characters, { family: 'higgsfield-soul', version: 'v2' }), [{ value: 'v2-ready', label: 'Mina · Soul ID · Soul 2' }, { value: 'pasted', label: 'Jun' }]);
  assert.deepEqual(identitySuggestions(characters, { family: 'other' }), []);
});
