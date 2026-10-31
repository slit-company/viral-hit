
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
export async function startMcp(studio) {
  const data = mkdtempSync(join(tmpdir(), 'vh-skill-eval-'));
  const providers = join(data, 'providers'); cpSync(resolve(studio, '../../examples/providers'), providers, { recursive: true });
  const connectors = join(data, 'connectors'); cpSync(resolve(studio, '../../examples/publishing-connectors'), connectors, { recursive: true });
  const env = { ...process.env, NODE_ENV: 'development', VIRAL_HIT_DATA_DIR: data, VIRAL_HIT_PROVIDERS_DIR: providers, VIRAL_HIT_PUBLISHING_CONNECTORS_DIR: connectors, VIRAL_HIT_ARCHIVE_DIR: join(data, 'archive'), VIRAL_HIT_FFPROBE: process.env.VIRAL_HIT_FFPROBE || 'ffprobe' };
  execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { cwd: studio, env, stdio: 'pipe' });
  const child = spawn(resolve(studio, 'node_modules/.bin/tsx'), ['scripts/mcp-server.ts'], { cwd: studio, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const worker = spawn(resolve(studio, 'node_modules/.bin/tsx'), ['scripts/harness-worker.ts'], { cwd: studio, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const workerLog = []; worker.stdout.on('data', d => workerLog.push(String(d))); worker.stderr.on('data', d => workerLog.push(String(d)));
  const pubWorker = spawn(resolve(studio, 'node_modules/.bin/tsx'), ['scripts/publication-worker.ts'], { cwd: studio, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '', id = 0; const waiting = new Map();
  child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (!line.trim()) continue; const msg = JSON.parse(line); waiting.get(msg.id)?.(msg); waiting.delete(msg.id); } });
  const rpc = (method, params) => new Promise((ok, fail) => { const n = ++id; const t = setTimeout(() => fail(Error('timeout ' + method)), 120000); waiting.set(n, m => { clearTimeout(t); ok(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'skill-eval', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const call = async (name, args = {}) => { const m = await rpc('tools/call', { name, arguments: args }); if (m.error) throw Error(name + ': ' + JSON.stringify(m.error)); const r = m.result; if (r.isError) throw Error(name + ': ' + (r.content?.[0]?.text ?? 'error').slice(0, 400)); return r.structuredContent?.result ?? r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? 'null'); };
  return { data, rpc, call, workerLog, close: () => { child.kill(); worker.kill(); pubWorker.kill(); } };
}

