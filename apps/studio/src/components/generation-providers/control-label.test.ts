import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CONTROL_CHOICES, CONTROL_LABELS } from './control-label-messages';
import { localizeChoiceLabel, localizeControlLabel } from './control-label';

const english = JSON.parse(readFileSync(new URL('../../../messages/en.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const keys = (prefix: string) => Object.keys(english).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)).sort();

test('every translated model control label and choice has a literal, tree-shakable entry', () => {
  assert.deepEqual(Object.keys(CONTROL_LABELS).sort(), keys('studio.control_label.'));
  assert.deepEqual(Object.keys(CONTROL_CHOICES).sort(), keys('studio.control_choice.'));
});

test('labels resolve by slug, unknown labels pass through and object keys are never called', () => {
  assert.equal(localizeControlLabel('Resolution'), CONTROL_LABELS.resolution());
  assert.equal(localizeChoiceLabel('Model default'), CONTROL_CHOICES.model_default());
  assert.equal(localizeControlLabel('Totally new knob'), 'Totally new knob');
  for (const label of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal(localizeChoiceLabel(label), label);
});
