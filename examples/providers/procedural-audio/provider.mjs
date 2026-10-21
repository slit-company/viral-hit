// Real procedural WAV output. No semantic prompt interpretation, speech, or AI model claims.
function sound({ frequency, seconds, wave }) {
  if (!(frequency >= 80 && frequency <= 2000 && seconds >= .1 && seconds <= 10) || !['sine', 'triangle'].includes(wave)) throw Error('Invalid sound parameters');
  const rate = 24000, samples = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
  const ascii = (offset, text) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const sine = Math.sin(2 * Math.PI * frequency * i / rate);
    const sample = wave === 'triangle' ? 2 / Math.PI * Math.asin(sine) : sine;
    const ramp = Math.min(1, i / 240, (samples - 1 - i) / 240);
    view.setInt16(44 + i * 2, Math.round(sample * .15 * 32767 * ramp), true);
  }
  return { status: 'succeeded', media: [{ data: bytes, mimeType: 'audio/wav' }] };
}
export async function createGeneration({ model, input, signal }) {
  signal.throwIfAborted();
  if (model.id.endsWith('-queued')) return { status: 'processing', taskId: Buffer.from(JSON.stringify(input.options)).toString('base64url') };
  return sound(input.options);
}
export async function checkStatus({ taskId, signal }) {
  signal.throwIfAborted();
  return sound(JSON.parse(Buffer.from(taskId, 'base64url').toString('utf8')));
}
