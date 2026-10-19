// Standalone local processor. FFmpeg is an operator-installed executable, not bundled code.
import { spawn } from 'node:child_process';

export default {
  recovery: 'replay',
  async submit(_input, context) {
    context.signal.throwIfAborted();
    return { id: context.key };
  },
  async poll(id, input, signal, context) {
    const saved = await context.readBinary();
    if (saved) return { state: 'succeeded', output: saved };
    const source = await context.readAsset('source');
    signal.throwIfAborted();
    const bytes = await new Promise((resolve, reject) => {
      const child = spawn(process.env.VIRAL_HIT_FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-t', String(input.duration), '-vn', '-af', `volume=${input.gain}`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { signal, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks = []; let size = 0, error = '';
      child.on('error', reject);
      child.stdout.on('data', chunk => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) { child.kill('SIGKILL'); reject(new Error('Decoded audio exceeds 8 MiB')); }
        else chunks.push(chunk);
      });
      child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-16000); });
      child.stdin.on('error', () => { /* close/error below reports decoder failure or cancellation */ });
      child.on('close', code => {
        if (code !== 0) reject(new Error(`Audio processing failed: ${error || code}`));
        else resolve(Buffer.concat(chunks));
      });
      child.stdin.end(source.bytes);
    });
    signal.throwIfAborted();
    const output = await context.publishBinary(bytes, { model: 'ffmpeg-audio-gain-v1', providerJobId: id, contentType: 'audio/wav', creditsUsed: '0' });
    return { state: 'succeeded', output };
  },
  async cancel() { return { state: 'canceled' }; },
};
