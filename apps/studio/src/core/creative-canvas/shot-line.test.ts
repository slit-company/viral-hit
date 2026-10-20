import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShotLine, writeShotLine } from './shot-line';

test('the shot line is written once at the end and read back into choices', () => {
  const prompt = writeShotLine('Nori waves.', { size: 'closeUp', angle: 'low', move: 'pushIn', light: 'goldenHour' }, 'video');
  assert.equal(prompt, 'Nori waves.\nShot: close-up, low angle, slow push in, golden hour.');
  assert.deepEqual(parseShotLine(prompt), { shot: { size: 'closeUp', angle: 'low', move: 'pushIn', light: 'goldenHour' }, custom: [] });
  assert.equal(writeShotLine(prompt, { size: 'wide' }, 'video'), 'Nori waves.\nShot: wide shot.');
  assert.equal(writeShotLine(prompt, {}, 'video'), 'Nori waves.');
});

test('custom terms and text after the shot line survive edits; images drop camera moves', () => {
  const typed = 'Shot: wide shot, rain on the lens.\nKeep the logo visible.';
  assert.deepEqual(parseShotLine(typed), { shot: { size: 'wide' }, custom: ['rain on the lens'] });
  assert.equal(writeShotLine(typed, { size: 'medium', move: 'orbit', lens: 'portrait85' }, 'image'), 'Keep the logo visible.\nShot: medium shot, 85mm portrait lens, rain on the lens.');
  assert.equal(writeShotLine('', { look: 'film35' }, 'image'), 'Shot: 35mm film look.');
});
