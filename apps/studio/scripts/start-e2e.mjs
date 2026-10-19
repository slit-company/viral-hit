import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'viral-hit-e2e-'));
const recipes = join(directory, 'recipes');
await cp('../../recipes', recipes, { recursive: true });
const extension = JSON.parse(await readFile(join(recipes, 'open-frame.json'), 'utf8'));
extension.id = 'community-fixture'; extension.title = 'Community fixture'; extension.author = 'External test author';
extension.parameters[0].label = 'Community frame prompt';
await writeFile(join(recipes, 'community-fixture.json'), JSON.stringify(extension));
const adapters = join(directory, 'adapters');
await cp('../../examples/adapters/tone', adapters, { recursive: true });
await cp('../../examples/adapters/audio-gain', adapters, { recursive: true });
await cp('../../examples/adapter-recipes/audio-gain.json', join(recipes, 'audio-gain.json'));
await cp('../../examples/adapter-recipes/procedural-tone.json', join(recipes, 'procedural-tone.json'));
const env = { ...process.env, VIRAL_HIT_FFMPEG: process.env.VIRAL_HIT_FFMPEG || execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim(), VIRAL_HIT_ADAPTERS_DIR: adapters, VIRAL_HIT_RECIPES_DIR: recipes, VIRAL_HIT_DATA_DIR: directory, VIRAL_HIT_MCP_HTTP_PORT: '3043', VIRAL_HIT_MCP_TOKEN: 'e2e-local-only' };
delete env.COMFY_API_KEY;
delete env.VIRAL_HIT_COMFYUI_URL;
delete env.VIRAL_HIT_HARNESS_DB;
execFileSync('pnpm', ['db:push'], { env, stdio: 'inherit' });
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed-e2e-media.ts'], { env, stdio: 'inherit' });
const children = [
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3042', '--strictPort'], { env, stdio: 'inherit' }),
  spawn(process.execPath, ['--import', 'tsx', 'scripts/mcp-server.ts', '--http'], { env, stdio: 'inherit' }),
];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
};
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
for (const child of children) child.once('exit', stop);
await Promise.all(children.map((child) => new Promise((resolve) => child.once('exit', resolve))));
await rm(directory, { recursive: true, force: true });
