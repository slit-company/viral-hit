import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homeSource = readFileSync(
  new URL('./product-home.tsx', import.meta.url),
  'utf8'
);
const routeSource = readFileSync(
  new URL('../../routes/index.tsx', import.meta.url),
  'utf8'
);
const toolsSource = readFileSync(
  new URL('./home-tools.tsx', import.meta.url),
  'utf8'
);

test('root route renders the Home surface instead of redirecting to projects', () => {
  assert.match(routeSource, /ProductHome/);
  assert.doesNotMatch(routeSource, /redirect/);
  assert.match(homeSource, /active="home"/);
  assert.match(toolsSource, /href="\/projects"/);
  assert.match(homeSource, /action="\/studio"/);
});
