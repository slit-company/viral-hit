// Procedural PCM audio example, not speech, music generation, or a model-quality demo.
// No imports or build tools required. All dependencies for a real adapter must be bundled.
export default {
  recovery: 'replay',
  async submit(_input, context) {
    context.signal.throwIfAborted();
    return { id: context.key }; // The same key always names the same deterministic local output.
  },
  async poll(id, input, signal, context) {
    const recovered = await context.readBinary();
    if (recovered) return { state: 'succeeded', output: recovered };
    signal.throwIfAborted();
    const rate = 24000, samples = Math.round(input.duration * rate);
    const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
    const ascii = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) {
      // Short ramps avoid clicks; low amplitude makes the calibration sample comfortable.
      const ramp = Math.min(1, i / 240, (samples - 1 - i) / 240);
      view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * input.frequency * i / rate) * 32767 * 0.15 * ramp), true);
    }
    const output = await context.publishBinary(bytes, { contentType: 'audio/wav', model: 'procedural-sine-v1', providerJobId: id, creditsUsed: '0' });
    return { state: 'succeeded', output };
  },
  async cancel() { return { state: 'canceled' }; },
};
