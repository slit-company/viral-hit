import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MEDIA_SLOTS, checkMediaInput, stageMedia } from '../src/media-input.mjs';
import compose from '../src/compose.mjs';

function fixture() {
  return { assets: Object.fromEntries(MEDIA_SLOTS.map(slot => [slot.id, slot.id === 'image-1' ? 'retained-image' : null])),
    timeline: { version: 1, output: { width: 640, height: 360, fps: 30 },
      sources: { hero: { type: 'image', path: 'asset:image-1' } },
      scenes: [{ id: 'hero', duration: '3s', layers: [{ type: 'media', source: 'hero', motion: 'kenburns' }] }],
    } };
}

test('project slots compose image, video, music, voice and source SFX without fixed templates', () => {
  const input = fixture(); input.assets['video-2'] = 'clip'; input.assets['audio-1'] = 'voice';
  Object.assign(input.timeline.sources, { clip: { type: 'video', path: 'asset:video-2', muted: true }, voice: { type: 'audio', path: 'asset:audio-1' } });
  input.timeline.scenes.push({ id: 'moving', duration: '2s', layers: [{ type: 'media', source: 'clip', speed: 0.5 }] });
  input.timeline.audio = { music: { source: 'voice', volume: 0.2 }, voice: [{ source: 'voice', at: '0s' }], cues: [{ sfx: 'voice', at: '1s' }] };
  assert.deepEqual(checkMediaInput(input), input.timeline);
  assert.equal(input.timeline.sources.hero.path, 'asset:image-1', 'authored source tokens remain portable');
});

test('unselected, missing, extra or wrong-kind slots fail before probing', () => {
  for (const mutate of [
    input => { input.assets['image-1'] = null; },
    input => { delete input.assets['audio-2']; },
    input => { input.assets.extra = 'asset'; },
    input => { input.assets['image-1'] = ''; },
    input => { input.timeline.sources.hero.type = 'video'; },
    input => { input.timeline.sources.hero = { type: 'color', color: '#000' }; },
  ]) {
    const input = fixture(); mutate(input); assert.throws(() => checkMediaInput(input));
  }
});

test('host paths, URLs, paid providers and resources hidden outside sources remain rejected', () => {
  for (const path of ['/private/file.png', '../file.png', 'file:///private/file.png', 'https://example.org/file.png', 'asset:image-1/../../file', 'asset:unknown']) {
    const input = fixture(); input.timeline.sources.hero.path = path; assert.throws(() => checkMediaInput(input));
  }
  for (const mutate of [
    input => { input.timeline.sources.hero.url = 'https://example.org'; },
    input => { input.timeline.sources.other = { type: 'generate', provider: 'ima2', prompt: 'paid' }; },
    input => { input.timeline.audio = { voice: [{ tts: { text: 'paid' } }] }; },
    input => { input.timeline.fonts = { custom: { path: '/private/font.ttf' } }; },
    input => { input.timeline.effects = [{ type: 'grade', lut: '/private/lut.cube' }]; },
    input => { input.timeline.audio = { cues: [{ at: '0s', sfx: 'elevenlabs:paid' }] }; },
  ]) {
    const input = fixture(); mutate(input); assert.throws(() => checkMediaInput(input));
  }
});

test('staging refuses playlist bytes and wrong media kinds before starting a native tool', async () => {
  const work = await mkdtemp(join(tmpdir(), 'vh-staging-test-'));
  try {
    const input = fixture(), document = checkMediaInput(input);
    const options = { env: { VID2_FFPROBE: '/must-not-start' }, signal: AbortSignal.timeout(1000) };
    const bytes = Buffer.from('#EXTM3U\nhttps://example.org/private');
    await assert.rejects(stageMedia(document, input, { readAsset: async () => ({ bytes, kind: 'image' }) }, work, options), /container/);
    await assert.rejects(stageMedia(document, input, { readAsset: async () => ({ bytes, kind: 'video' }) }, work, options), /Invalid media bytes/);
    assert.deepEqual(await readdir(work), []);
  } finally { await rm(work, { recursive: true, force: true }); }
});

test('completed composition recovers before reading any now-unavailable source', async () => {
  const saved = { binaryReceipt: { id: 'saved' } };
  const result = await compose.poll('stable-key', {}, AbortSignal.timeout(1000), {
    readBinary: async () => saved, readAsset: async () => assert.fail('must not reread'),
  });
  assert.deepEqual(result, { state: 'succeeded', output: saved });
});
