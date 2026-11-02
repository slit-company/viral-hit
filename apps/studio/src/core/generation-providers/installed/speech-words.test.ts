import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { providerManifestSchema, providerResultSchema } from './manifest';
import { InstalledProviderRuntime } from './runtime.server';
import type { EffectRecord } from '@/core/adapters/base-adapter';

const root = mkdtempSync(join(tmpdir(), 'vh-speech-words-'));
process.env.VIRAL_HIT_DATA_DIR = root;
after(() => rmSync(root, { recursive: true, force: true }));
const WAV = 'new Uint8Array([82,73,70,70,1,0,0,0,87,65,86,69])';

test('voice providers return word timing with audio; it is validated and kept with the generation output', async () => {
  const words = [{ text: 'Find', start: 0, end: 0.4 }, { text: 'it', start: 0.5, end: 0.7 }];
  assert.equal(providerResultSchema.safeParse({ status: 'succeeded', media: [{ data: new Uint8Array([1]), mimeType: 'audio/wav' }], speechWords: words }).success, true);
  assert.equal(providerResultSchema.safeParse({ status: 'succeeded', media: [{ data: new Uint8Array([1]), mimeType: 'audio/wav' }], speechWords: [words[1], words[0]] }).success, false, 'out of order');
  assert.equal(providerResultSchema.safeParse({ status: 'processing', taskId: 't', speechWords: words }).success, false, 'only with finished audio');
  const manifest = providerManifestSchema.parse({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'voice-test', label: 'Voice test', models: [{ id: 'voice-test-speech', name: 'Voice', kind: 'audio' }, { id: 'voice-test-image', name: 'Image', kind: 'image', aspectRatios: ['1:1'] }] });
  const runtime = new InstalledProviderRuntime(manifest, `export async function createGeneration(){ return { status: 'succeeded', media: [{ data: ${WAV}, mimeType: 'audio/wav' }], speechWords: ${JSON.stringify(words)} }; }`);
  const result = await runtime.call('createGeneration', { linkName: 'voice-test-speech' } as EffectRecord, { input: {} });
  assert.equal(result.status, 'succeeded');
  assert.deepEqual((result.output as { speech_words?: unknown }).speech_words, words);
  const image = await runtime.call('createGeneration', { linkName: 'voice-test-image' } as EffectRecord, { input: {} });
  assert.equal(image.status, 'failed', 'an image model cannot return speech timing');
});
