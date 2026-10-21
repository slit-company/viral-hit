import { build } from 'esbuild';
import { whisperDescriptor } from '../src/descriptor.mjs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url))), dist = join(root, 'dist');
await mkdir(join(dist, 'adapters'), { recursive: true });
const entry = 'whisper.mjs';
await build({ entryPoints: [join(root, 'src/adapter.mjs')], outfile: join(dist, 'adapters', entry), bundle: true, platform: 'node', format: 'esm', target: 'node24' });
const source = await readFile(join(dist, 'adapters', entry), 'utf8');
const descriptor = whisperDescriptor(entry, createHash('sha256').update(source).digest('hex'));
await writeFile(join(dist, 'adapters/whisper.json'), JSON.stringify(descriptor, null, 2) + '\n');
const metadata = { id: 'local-transcription', version: '1.0.0', title: 'Local speech and editable captions', description: 'Recognize selected source speech locally, review estimated timing and prepare editable captions for video or audio with a cover image.', author: 'Viral Hit contributors', license: 'Apache-2.0', scope: 'general' };
await writeFile(join(dist, 'whisper.runtime.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-runtime-package', ...metadata,
  requirements: 'An operator-installed whisper.cpp CLI and compatible model with explicit SHA-256 pins, plus FFmpeg/FFprobe. No engines or models are installed by this package.', entries: [{ kind: 'adapter', manifest: descriptor, source }] }, null, 2) + '\n');
const recipes = await Promise.all(['local-video-captions', 'local-audio-captions'].map(async name => JSON.parse(await readFile(join(root, 'recipes', name + '.json'), 'utf8'))));
await writeFile(join(dist, 'whisper.pack.json'), JSON.stringify({ schemaVersion: 1, kind: 'viral-hit-pack', ...metadata, useCases: ['captions', 'speech', 'editing'], recipes }, null, 2) + '\n');
console.log('Built an optional runtime package and two portable caption recipes; no speech engine/model installed.');
