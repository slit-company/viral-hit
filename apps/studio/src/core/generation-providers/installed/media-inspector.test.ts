import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { providerManifestSchema } from './manifest';
import { InstalledProviderRuntime } from './runtime.server';
import type { EffectRecord } from '@/core/adapters/base-adapter';

test('the independent inspector measures real encoded media and bounds downloads without an AI service', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vh-inspector-test-'));
  const originalProbe = process.env.VIRAL_HIT_FFPROBE;
  process.env.VIRAL_HIT_FFPROBE = originalProbe || 'ffprobe';
  const sourcePath = join(directory, 'source.mp4');
  let server: ReturnType<typeof createServer> | undefined;
  try {
    execFileSync(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=180x320:r=12:d=1', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourcePath]);
    const bytes = await readFile(sourcePath);
    server = createServer((req, res) => {
      if (req.url === '/large') { res.writeHead(200, { 'content-length': String(65 * 1024 * 1024) }); res.end(); }
      else if (req.url === '/redirect') { res.writeHead(302, {location:'/source'}); res.end(); }
      else res.end(bytes);
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const manifest = providerManifestSchema.parse(JSON.parse(await readFile('../../examples/providers/media-inspector/provider.json', 'utf8')));
    // Exercise the optional URL fallback separately from installed project-media delivery.
    delete manifest.referenceDelivery;
    const runtime = new InstalledProviderRuntime(manifest, await readFile('../../examples/providers/media-inspector/provider.mjs', 'utf8'));
    const effect = { linkName: 'vertical-delivery-review', type: 3 } as EffectRecord;
    const result = await runtime.call('createGeneration', effect, {input:{videoUrl:url+'/source', prompt:'Check delivery'}});
    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    const text = (result.output as {analysis_text:string}).analysis_text;
    assert.match(text, /180 × 320/); assert.match(text, /approximately 9:16/); assert.match(text, /Audio: 1 stream/);
    assert.ok(text.includes(createHash('sha256').update(bytes).digest('hex')));
    assert.match(text, /not interpreted/); assert.match(text, /no visual/);
    for (const path of ['/large', '/redirect']) assert.equal((await runtime.call('createGeneration', effect, {input:{videoUrl:url+path, prompt:'Check'}})).status, 'failed');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    if (originalProbe === undefined) delete process.env.VIRAL_HIT_FFPROBE; else process.env.VIRAL_HIT_FFPROBE = originalProbe;
    await rm(directory, {recursive:true,force:true});
  }
});
