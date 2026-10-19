import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { PublicationMediaStore } from '../src/core/publishing/media-store.server';
import { PUBLICATION_BLOCK_BYTES } from '../src/core/publishing/media-files.server';

// Opt-in local byte-pipeline measurement, not a model, codec or live publishing benchmark.
const evidence = process.argv[2], mebibytes = Number(process.argv[3] ?? 256);
if (!evidence || !isAbsolute(evidence) || !Number.isInteger(mebibytes) || mebibytes < 16 || mebibytes > 1024) throw new Error('Usage: node --expose-gc --import tsx scripts/verify-publication-media.ts /absolute/evidence-directory [16..1024 MiB]');
await mkdir(evidence, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'vh-publication-memory-'));
const store = new PublicationMediaStore(join(directory, 'retained'));
const signal = AbortSignal.timeout(120000), sizeBytes = mebibytes * 1024 ** 2 + 137;
let timer: ReturnType<typeof setInterval> | undefined;
try {
  const source = join(directory, 'source.bin'), sourceHash = createHash('sha256');
  const file = await open(source, 'wx', 0o600), block = Buffer.alloc(PUBLICATION_BLOCK_BYTES);
  for (let index = 0; index < block.length; index++) block[index] = index % 251;
  try {
    for (let offset = 0; offset < sizeBytes; offset += block.length) {
      const part = block.subarray(0, Math.min(block.length, sizeBytes - offset));
      sourceHash.update(part);
      let written = 0;
      while (written < part.length) {
        const result = await file.write(part, written, part.length - written, offset + written);
        if (!result.bytesWritten) throw new Error('Fixture write failed to advance');
        written += result.bytesWritten;
      }
    }
    await file.sync();
  } finally { await file.close(); }
  globalThis.gc?.();
  const baseline = process.memoryUsage();
  let peakRss = baseline.rss, peakArrayBuffers = baseline.arrayBuffers;
  const sample = () => {
    const memory = process.memoryUsage();
    peakRss = Math.max(peakRss, memory.rss); peakArrayBuffers = Math.max(peakArrayBuffers, memory.arrayBuffers);
  };
  timer = setInterval(sample, 5);
  const pin = { assetId: 'fixture', sha256: sourceHash.digest('hex'), sizeBytes, contentType: 'video/mp4' };
  let started = performance.now();
  await store.prepare('project', pin, source, signal);
  const preparationMs = performance.now() - started;
  await rm(source); await store.check('project', pin, signal);
  const receivedHash = createHash('sha256'); let reads = 0;
  started = performance.now();
  for (let offset = 0; offset < sizeBytes; offset += PUBLICATION_BLOCK_BYTES) {
    const bytes = await store.read('project', pin, offset, Math.min(PUBLICATION_BLOCK_BYTES, sizeBytes - offset), signal);
    receivedHash.update(bytes); reads++; sample();
  }
  const sequentialReadMs = performance.now() - started;
  if (receivedHash.digest('hex') !== pin.sha256) throw new Error('Retained bytes differ from source');
  const offset = PUBLICATION_BLOCK_BYTES - 7;
  const unaligned = await store.read('project', pin, offset, PUBLICATION_BLOCK_BYTES, signal);
  for (let index = 0; index < unaligned.length; index++) {
    if (unaligned[index] !== ((offset + index) % PUBLICATION_BLOCK_BYTES) % 251) throw new Error('Unaligned byte range differs');
  }
  sample();
  const report = {
    recordedAt: new Date().toISOString(), node: process.version, platform: process.platform, sizeBytes,
    sha256: pin.sha256, blockBytes: PUBLICATION_BLOCK_BYTES, reads, preparationMs, sequentialReadMs,
    baselineRssBytes: baseline.rss, peakRssBytes: peakRss, rssIncreaseBytes: peakRss - baseline.rss,
    baselineArrayBufferBytes: baseline.arrayBuffers, peakArrayBufferBytes: peakArrayBuffers,
    unalignedBytesVerified: unaligned.length, sourceDeletedBeforeReads: true,
    scope: 'Synthetic local bytes through retained storage. No codec, network, OAuth, provider or UI benchmark. Sampled process memory includes V8/GC behavior.',
  };
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (timer) clearInterval(timer);
  store.close(); await rm(directory, { recursive: true, force: true });
}
