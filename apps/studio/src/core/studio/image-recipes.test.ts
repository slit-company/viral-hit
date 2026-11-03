import test from 'node:test';
import assert from 'node:assert/strict';
import { relightPrompt, textEditPrompt } from './image-recipes';

test('relighting names the light and protects everything that is not light', () => {
  const prompt = relightPrompt('neon-night', 'left', 'Keep the rain visible.');
  assert.match(prompt, /^Relight this image with night lighting from saturated magenta and cyan neon signs, with colored reflections, coming from the left\./);
  assert.match(prompt, /Change only the lighting, shadows, highlights and reflections\./);
  assert.match(prompt, /faces and poses/);
  assert.match(prompt, /Keep the rain visible\.$/);
});

test('text replacement quotes both texts and keeps the lettering', () => {
  assert.equal(textEditPrompt('SALE  50%', 'NEW "DROP"'), 'Replace the text "SALE 50%" in this image with "NEW \'DROP\'". Match the original lettering: the same font, weight, size, color, outline, spacing, perspective and position. Change nothing else in the image.');
  assert.throws(() => textEditPrompt(' ', 'x'), /Enter the text/);
});
