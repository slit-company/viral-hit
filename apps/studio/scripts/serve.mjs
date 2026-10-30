import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (existsSync('.env')) process.loadEnvFile('.env');
await import('./default-providers.mjs');
process.env.HOST ||= '127.0.0.1';
const production = process.argv.includes('--production');
if (!production) execFileSync(process.execPath, ['--import', 'tsx', 'scripts/prepare-paraglide.ts'], { stdio: 'inherit' });
const children = [
  spawn(process.execPath, production ? ['.output/server/index.mjs'] : ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', process.env.PORT || '3808', '--strictPort'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--import', 'tsx', 'scripts/harness-worker.ts'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--import', 'tsx', 'scripts/publication-worker.ts'], { stdio: 'inherit' }),
];
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
for (const child of children) { child.once('error', stop); child.once('exit', code => { if (code) process.exitCode = code; stop(); }); }
await Promise.all(children.map(child => new Promise(resolve => child.once('exit', resolve))));
