import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getViralHitDataRoot } from '@/config/data-root';

/** Provider credentials only. Values never belong in manifests, diagnostics or project exports. */
export type ConfigurationManifest = { id: string; environment: string[]; configurationDelivery?: 'request' };
type Stored = { values: Record<string, string>; revision: string };
const empty = (): Stored => ({ values: {}, revision: 'none' });
const root = () => join(getViralHitDataRoot(), 'provider-credentials');
const failure = () => Error('Provider credential storage is unavailable. Restore its key and encrypted files together.');
function privateFile(file: string) {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size > 160_000)) throw failure();
  return stat;
}
function key(create: boolean): Buffer | null {
  const directory = root();
  if (!existsSync(directory)) {
    if (!create) return null;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw failure();
  const file = join(directory, 'workspace.key');
  if (!privateFile(file)) {
    if (readdirSync(directory).some(name => name.endsWith('.sealed'))) throw failure();
    if (!create) return null;
    try { writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw failure(); }
  }
  privateFile(file);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const result = readFileSync(fd); if (result.length !== 32) throw failure(); return result; }
  finally { closeSync(fd); }
}
function filename(id: string) {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) throw Error('Invalid provider ID');
  return join(root(), id + '.sealed');
}
export function readProviderCredentials(id: string): Stored {
  const file = filename(id), secret = key(false);
  if (!secret) return empty();
  try {
    if (!privateFile(file)) return empty();
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try { bytes = readFileSync(fd); } finally { closeSync(fd); }
    if (bytes.length < 29) throw failure();
    const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from('viral-hit/provider/v1/' + id));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const values: unknown = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.entries(values).some(([name, value]) => !/^[A-Z][A-Z0-9_]{0,100}$/.test(name) || typeof value !== 'string' || value.length > 8192)) throw failure();
    return { values: values as Record<string, string>, revision: createHash('sha256').update(bytes).digest('hex') };
  } catch { throw failure(); } finally { secret.fill(0); }
}
export function resolveProviderConfiguration(manifest: ConfigurationManifest) {
  const saved = manifest.configurationDelivery === 'request' ? readProviderCredentials(manifest.id).values : {};
  // Operator environment always takes precedence; never mutate process.env.
  return Object.fromEntries(manifest.environment.map(name => [name, process.env[name]?.trim() || saved[name] || '']));
}
export function providerConfigurationView(manifest: ConfigurationManifest) {
  const stored = manifest.configurationDelivery === 'request' ? readProviderCredentials(manifest.id) : empty();
  return { revision: stored.revision, fields: manifest.environment.map(name => ({
    name, source: process.env[name]?.trim() ? 'environment' as const : stored.values[name] ? 'workspace' as const : 'missing' as const,
  })) };
}
/** Revision + exclusive lock prevents another process silently overwriting a concurrent edit. */
export function changeProviderCredentials(manifest: ConfigurationManifest, expectedRevision: string, changes: Record<string, string | null>) {
  if (manifest.configurationDelivery !== 'request') throw Error('This provider uses server environment settings');
  if (Object.keys(changes).some(name => !manifest.environment.includes(name))) throw Error('Unknown provider setting');
  for (const [name, value] of Object.entries(changes)) {
    if (process.env[name]?.trim()) throw Error('This setting is managed by the server environment');
    if (value !== null && (!value.trim() || value.length > 8192 || /[\r\n\0]/.test(value))) throw Error('Invalid provider setting');
  }
  const file = filename(manifest.id), secret = key(true)!;
  const lock = file + '.lock', temporary = file + '.' + randomUUID() + '.tmp';
  let locked = false;
  try {
    try { closeSync(openSync(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)); locked = true; }
    catch { throw Error('Provider settings are being edited. Refresh and try again.'); }
    const current = readProviderCredentials(manifest.id);
    if (current.revision !== expectedRevision) throw Error('Provider settings changed. Refresh before saving.');
    const values = { ...current.values };
    for (const [name, value] of Object.entries(changes)) { if (value === null) delete values[name]; else values[name] = value.trim(); }
    const encoded = JSON.stringify(values);
    if (Buffer.byteLength(encoded) > 64_000) throw Error('Provider settings exceed the storage limit');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv);
    cipher.setAAD(Buffer.from('viral-hit/provider/v1/' + manifest.id));
    const encrypted = Buffer.concat([cipher.update(encoded), cipher.final()]);
    writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { flag: 'wx', mode: 0o600 });
    privateFile(file);
    renameSync(temporary, file);
    return providerConfigurationView(manifest);
  } finally { secret.fill(0); rmSync(temporary, { force: true }); if (locked) rmSync(lock, { force: true }); }
}
