import { readFile, stat, realpath } from 'node:fs/promises';
import { isAbsolute, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const REA_VERSION = '6.8.0';
export const hash = data => createHash('sha256').update(data).digest('hex');
export const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export async function readBounded(file, max = 131072) {
  const info = await stat(file); if (!info.isFile() || info.size > max) throw Error('REA configuration or evidence file exceeds its limit');
  const bytes = await readFile(file); if (bytes.length > max) throw Error('REA file changed beyond its limit'); return bytes;
}
function absolute(value, name) { if (typeof value !== 'string' || !isAbsolute(value)) throw Error(name + ' must be an absolute path'); return value; }
export function validateTarget(target) {
  if (!target || !validId(target.id) || typeof target.label !== 'string' || !target.label.trim() || target.label.length > 120) throw Error('Invalid REA target identity');
  if (target.kind === 'javascript') absolute(target.path, 'Application path');
  else if (target.kind === 'website') {
    const endpoint = new URL(target.endpoint), origin = new URL(target.origin);
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname) || !endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw Error('Use an explicit loopback HTTP CDP endpoint');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== target.origin || !validId(target.targetId)) throw Error('Use one exact website origin and browser target ID');
  } else throw Error('REA target must be javascript or website');
  return target;
}
export async function configuration(targetId, env = process.env) {
  if (!validId(targetId)) throw Error('Choose a configured REA target ID');
  const node = await realpath(absolute(env.VIRAL_HIT_REA_NODE, 'VIRAL_HIT_REA_NODE'));
  const cli = await realpath(absolute(env.VIRAL_HIT_REA_CLI, 'VIRAL_HIT_REA_CLI'));
  const directory = absolute(env.VIRAL_HIT_REA_EVIDENCE_DIR, 'VIRAL_HIT_REA_EVIDENCE_DIR');
  const catalog = await readBounded(absolute(env.VIRAL_HIT_REA_TARGETS, 'VIRAL_HIT_REA_TARGETS'));
  const parsed = JSON.parse(catalog); if (!Array.isArray(parsed.targets) || parsed.targets.length > 32 || parsed.schemaVersion !== 1) throw Error('Invalid REA target catalog');
  const targets = parsed.targets.map(validateTarget);
  if (new Set(targets.map(target => target.id)).size !== targets.length) throw Error('Duplicate REA target IDs');
  const target = targets.find(target => target.id === targetId); if (!target) throw Error('REA target ID is not configured');
  const cliBytes = await readBounded(cli, 1024 * 1024);
  if (!/^[a-f0-9]{64}$/.test(env.VIRAL_HIT_REA_CLI_SHA256 ?? '') || hash(cliBytes) !== env.VIRAL_HIT_REA_CLI_SHA256) throw Error('REA CLI digest mismatch');
  const manifest = JSON.parse(await readBounded(resolve(dirname(cli), '../package.json')));
  if (manifest.name !== 'rea-agents' || manifest.version !== REA_VERSION) throw Error('This bridge requires rea-agents ' + REA_VERSION);
  return { node, cli, directory, target, identity: hash(JSON.stringify({ node, cli, cliSha256: hash(cliBytes), catalogSha256: hash(catalog), version: manifest.version })) };
}
