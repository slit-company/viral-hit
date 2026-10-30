#!/usr/bin/env node
// Builds every bundled provider into ./providers so Studio, the worker and MCP load them without extra setup.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, 'providers');
const bundled = [['comfy-router', 'comfy'], ['higgsfield', 'higgsfield'], ['sume', 'sume']];
mkdirSync(target, { recursive: true });
for (const [folder, id] of bundled) {
  const directory = join(root, 'extensions', folder);
  const npm = existsSync(join(directory, 'package-lock.json'));
  const run = (command, args) => execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
  if (!existsSync(join(directory, 'node_modules'))) npm ? run('npm', ['ci', '--no-audit', '--no-fund']) : run('pnpm', ['install', '--frozen-lockfile']);
  run(npm ? 'npm' : 'pnpm', ['run', 'build']);
  rmSync(join(target, id), { recursive: true, force: true });
  cpSync(join(directory, 'dist', 'providers', id), join(target, id), { recursive: true });
}
console.log('Providers ready in ' + target + ': ' + bundled.map(([, id]) => id).join(', ') + '. Add API keys in Extensions → Connect creative APIs.');
