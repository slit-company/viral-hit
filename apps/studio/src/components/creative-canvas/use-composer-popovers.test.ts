import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOpenPopoverOnPointerDown } from './use-composer-popovers';

test('a press keeps only the open popover and only when it lands inside it', () => {
  assert.equal(resolveOpenPopoverOnPointerDown('shot', true), 'shot');
  assert.equal(resolveOpenPopoverOnPointerDown('shot', false), null);
  assert.equal(resolveOpenPopoverOnPointerDown(null, true), null);
});
