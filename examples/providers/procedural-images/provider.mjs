// A dependency-free generation provider: it draws a gradient whose colors come from the prompt.
// Use it to try the Canvas, MCP generation and provider installation without a model or API key.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const SIZES = { '1:1': [512, 512], '16:9': [640, 360], '9:16': [360, 640], '4:3': [576, 432], '3:4': [432, 576] };
const QUEUE = join(tmpdir(), 'viral-hit-procedural-images');

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function render(prompt, aspectRatio) {
  const hash = createHash('sha256').update(prompt).digest();
  const [width, height] = SIZES[aspectRatio] ?? SIZES['1:1'];
  const from = [hash[0], hash[1], hash[2]], to = [hash[3], hash[4], hash[5]];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = (x / width + y / height) / 2, offset = y * (width * 3 + 1) + 1 + x * 3;
    for (let channel = 0; channel < 3; channel++) raw[offset + channel] = Math.round(from[channel] + (to[channel] - from[channel]) * t);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Instant model: returns the image. Queued model: returns a task id, as hosted APIs do, and finishes on checkStatus. */
export async function createGeneration({ model, input }) {
  const request = { prompt: input.prompt, aspectRatio: input.aspectRatio ?? '1:1' };
  if (model.id !== 'procedural-gradient-queued') return { status: 'succeeded', media: [{ data: render(request.prompt, request.aspectRatio), mimeType: 'image/png' }] };
  const taskId = createHash('sha256').update(JSON.stringify(request) + Date.now()).digest('hex').slice(0, 32);
  await mkdir(QUEUE, { recursive: true });
  await writeFile(join(QUEUE, taskId + '.json'), JSON.stringify(request));
  return { status: 'processing', taskId };
}

export async function checkStatus({ taskId }) {
  if (!/^[a-f0-9]{32}$/.test(taskId)) return { status: 'failed', error: 'Unknown task' };
  const request = JSON.parse(await readFile(join(QUEUE, taskId + '.json'), 'utf8'));
  return { status: 'succeeded', media: [{ data: render(request.prompt, request.aspectRatio), mimeType: 'image/png' }] };
}
