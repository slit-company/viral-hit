import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A voice provider for browser tests: real WAV bytes plus word timing taken from the prompt, the same
 * shape ElevenLabs returns. It does not synthesize speech.
 */
const source = `export async function createGeneration({ input, signal }) {
  signal.throwIfAborted();
  const words = String(input.prompt ?? '').trim().split(/\\s+/).filter(Boolean).slice(0, 40);
  if (!words.length) throw Error('Write the narration');
  const step = 0.4, seconds = words.length * step + 0.2, rate = 16000, samples = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
  const ascii = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 3000), true);
  return { status: 'succeeded', media: [{ data: bytes, mimeType: 'audio/wav' }], speechWords: words.map((text, index) => ({ text, start: index * step, end: index * step + 0.35 })) };
}`;

export async function prepareVoiceFixture(providers) {
  const directory = join(providers, 'voice-fixture');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'provider.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-provider', id: 'voice-fixture', label: 'Voice timing fixture', scope: 'general', models: [{ id: 'voice-fixture-speech', name: 'Voice timing fixture', kind: 'audio', studioTasks: ['text-to-speech'] }] }));
  await writeFile(join(directory, 'provider.mjs'), source);
}
