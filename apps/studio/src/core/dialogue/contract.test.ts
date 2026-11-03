import test from 'node:test';
import assert from 'node:assert/strict';
import { dialogueSpeakers, parseDialogueScript } from './contract';

test('a script becomes ordered turns with their speakers', () => {
  const lines = parseDialogueScript('Opening shot of the street.\nMina: Did you see that?\n\n준：응, 한 번 더!\nit was fast\nMina:Again.');
  assert.deepEqual(lines, [
    { speaker: 'Narrator', text: 'Opening shot of the street.' },
    { speaker: 'Mina', text: 'Did you see that?' },
    { speaker: '준', text: '응, 한 번 더! it was fast' },
    { speaker: 'Mina', text: 'Again.' },
  ]);
  assert.deepEqual(dialogueSpeakers(lines), ['Narrator', 'Mina', '준']);
  assert.deepEqual(parseDialogueScript('  \n '), []);
});
