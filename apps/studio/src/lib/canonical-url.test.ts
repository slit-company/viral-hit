import assert from 'node:assert/strict';
import test from 'node:test';

import { getWwwRedirectLocation } from './canonical-url';

test('redirects www hosts to the https apex host', () => {
  assert.equal(
    getWwwRedirectLocation('http://www.viral-hit.example/templates?tab=video'),
    'https://viral-hit.example/templates?tab=video'
  );
});

test('redirects any www subdomain to its non-www canonical host', () => {
  assert.equal(
    getWwwRedirectLocation('https://www.assets.viral-hit.example/path#preview'),
    'https://assets.viral-hit.example/path#preview'
  );
});

test('does not redirect canonical or local hosts', () => {
  assert.equal(getWwwRedirectLocation('https://viral-hit.example/'), null);
  assert.equal(getWwwRedirectLocation('http://www.localhost:3002/'), null);
});
