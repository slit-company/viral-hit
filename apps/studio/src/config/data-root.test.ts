import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getViralHitDatabaseUrl,
  getViralHitDataRoot,
} from './data-root';

test('uses the repository data directory by default', () => {
  assert.equal(
    getViralHitDataRoot('/tmp/viral-hit-repository', undefined),
    '/tmp/viral-hit-repository/data'
  );
  assert.equal(
    getViralHitDatabaseUrl('/tmp/viral-hit-repository', undefined),
    'file:data/local.db'
  );
});

test('uses an explicit application-data directory for packaged runtimes', () => {
  assert.equal(
    getViralHitDataRoot('/tmp/ignored', '/tmp/viral-hit-user-data'),
    '/tmp/viral-hit-user-data'
  );
  assert.equal(
    getViralHitDatabaseUrl('/tmp/ignored', '/tmp/viral-hit-user-data'),
    'file:/tmp/viral-hit-user-data/local.db'
  );
});
