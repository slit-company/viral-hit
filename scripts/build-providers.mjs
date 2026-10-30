#!/usr/bin/env node
// Builds every bundled provider into ./providers so Studio, the worker and MCP load them without extra setup.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, 'providers');
// Each extension builds one or more provider folders into its dist/providers directory.
const bundled = ['comfy-router', 'sume', 'model-apis'];
mkdirSync(target, { recursive: true });
const ready = [];
for (const folder of bundled) {
  const directory = join(root, 'extensions', folder);
  const npm = existsSync(join(directory, 'package-lock.json'));
  const run = (command, args) => execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
  if (!existsSync(join(directory, 'node_modules'))) npm ? run('npm', ['ci', '--no-audit', '--no-fund']) : run('pnpm', ['install', '--frozen-lockfile']);
  run(npm ? 'npm' : 'pnpm', ['run', 'build']);
  for (const id of readdirSync(join(directory, 'dist', 'providers'))) {
    rmSync(join(target, id), { recursive: true, force: true });
    cpSync(join(directory, 'dist', 'providers', id), join(target, id), { recursive: true });
    ready.push(id);
  }
}
console.log('Providers ready in ' + target + ': ' + ready.join(', ') + '. Add API keys in Connections.');
