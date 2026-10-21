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
// Installed generation providers: the dependency-free example stands in for a model an operator adds.
const providers = join(directory, 'providers');
await cp('../../examples/providers', providers, { recursive: true });
await cp('../../examples/providers/procedural-images', join(providers, 'protected-fixture'), { recursive: true });
const protectedManifest = JSON.parse(await readFile(join(providers, 'protected-fixture', 'provider.json'), 'utf8'));
Object.assign(protectedManifest, { id: 'protected-fixture', label: 'Studio image service', scope: 'specialized', environment: ['VIRAL_HIT_E2E_PROVIDER_KEY'], models: [{ ...protectedManifest.models[0], id: 'protected-fixture-image', name: 'Studio image model' }] });
await writeFile(join(providers, 'protected-fixture', 'provider.json'), JSON.stringify(protectedManifest));
// Discovery must never import the module, even when the status page is refreshed.
await writeFile(join(providers, 'protected-fixture', 'provider.mjs'), 'throw new Error("DIAGNOSTICS_MUST_NOT_EXECUTE_MODULES");');
const env = { ...process.env, VIRAL_HIT_FFMPEG: process.env.VIRAL_HIT_FFMPEG || execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim(), VIRAL_HIT_ADAPTERS_DIR: adapters, VIRAL_HIT_PROVIDERS_DIR: providers, VIRAL_HIT_RECIPES_DIR: recipes, VIRAL_HIT_DATA_DIR: directory, VIRAL_HIT_MCP_HTTP_PORT: '3043', VIRAL_HIT_MCP_TOKEN: 'e2e-local-only' };
delete env.VIRAL_HIT_E2E_PROVIDER_KEY;
const publishingConnectors = join(directory, 'publishing-connectors');
await cp('../../examples/publishing-connectors', publishingConnectors, { recursive: true });
env.VIRAL_HIT_PUBLISHING_CONNECTORS_DIR = publishingConnectors;
env.VIRAL_HIT_ARCHIVE_DIR = join(directory, 'release-archive');
delete env.COMFY_API_KEY;
delete env.VIRAL_HIT_COMFYUI_URL;
delete env.VIRAL_HIT_HARNESS_DB;
// Browser consent navigation is intercepted by tests; these credentials never reach Google.
env.VIRAL_HIT_GOOGLE_CLIENT_ID = 'fixture.apps.googleusercontent.com';
env.VIRAL_HIT_GOOGLE_CLIENT_SECRET = 'fixture-only-secret';
env.VIRAL_HIT_GOOGLE_REDIRECT_URI = 'http://127.0.0.1:3042/api/app/publishing/youtube/callback';
delete env.VIRAL_HIT_PUBLISHING_KEY;
env.VIRAL_HIT_META_APP_ID = '123';
env.VIRAL_HIT_META_APP_SECRET = 'fixture-meta-only-secret';
env.VIRAL_HIT_META_LOGIN_CONFIG_ID = '456';
env.VIRAL_HIT_META_REDIRECT_URI = 'http://127.0.0.1:3042/api/app/publishing/instagram/callback';
execFileSync('pnpm', ['db:push'], { env, stdio: 'inherit' });
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed-e2e-media.ts'], { env, stdio: 'inherit' });
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed-e2e-packs.ts'], { env, stdio: 'inherit' });
const children = [
  spawn(process.execPath, ['--import', './scripts/e2e-pack-download.mjs', '--import', './scripts/e2e-meta-fetch.mjs', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3042', '--strictPort'], { env, stdio: 'inherit' }),
  spawn(process.execPath, ['--import', './scripts/e2e-pack-download.mjs', '--import', 'tsx', 'scripts/mcp-server.ts', '--http'], { env, stdio: 'inherit' }),
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
