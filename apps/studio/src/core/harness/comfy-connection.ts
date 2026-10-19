import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { getViralHitDataRoot } from '../../config/data-root';

export function normalizeComfyUrl(value: string): URL {
  if (value.length > 2000) throw new Error('ComfyUI URL exceeds 2,000 characters');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete HTTP(S) ComfyUI URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('ComfyUI URL must be HTTP(S), without credentials, query or fragment');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
const path = () => join(getViralHitDataRoot(), 'connections.sqlite');
function assertFile(file: string) {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Connection settings must be a regular database file');
}
type Stored = { revision: number; url: string | null };
const empty: Stored = { revision: 0, url: null };
const environment = () => process.env.VIRAL_HIT_COMFYUI_URL?.trim();
function read(db: DatabaseSync): Stored {
  const row = db.prepare('SELECT revision, url FROM connection WHERE id=1').get() as Stored | undefined;
  return row ? { revision: row.revision, url: row.url === null ? null : normalizeComfyUrl(row.url).href } : { ...empty };
}
function stored(): Stored {
  const file = path(); assertFile(file);
  if (!existsSync(file)) return { ...empty };
  const db = new DatabaseSync(file, { readOnly: true });
  try { db.exec('PRAGMA busy_timeout=5000'); return read(db); } finally { db.close(); }
}
export function readComfyConnection() {
  const value = environment();
  if (value) {
    try { return { url: normalizeComfyUrl(value).href, revision: 0, source: 'environment' as const, editable: false, error: null }; }
    catch { return { url: null, revision: 0, source: 'environment' as const, editable: false, error: 'VIRAL_HIT_COMFYUI_URL is invalid. Correct it on the server and worker, then restart them.' }; }
  }
  const local = stored();
  return { ...local, source: local.url ? 'workspace' as const : 'none' as const, editable: true, error: null };
}
export class ConnectionConflictError extends Error {}
export function saveComfyConnection(url: string | null, expectedRevision: number) {
  if (environment()) throw new ConnectionConflictError('This connection is managed by VIRAL_HIT_COMFYUI_URL. Change it on the server and worker.');
  const normalized = url === null ? null : normalizeComfyUrl(url).href;
  const file = path(); assertFile(file); mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS connection (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL, url TEXT); BEGIN IMMEDIATE');
    const current = read(db);
    if (current.revision !== expectedRevision) throw new ConnectionConflictError('Connection settings changed. Reload them before saving.');
    if (current.url !== normalized) db.prepare('INSERT INTO connection (id, revision, url) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,url=excluded.url').run(current.revision + 1, normalized);
    const result = read(db); db.exec('COMMIT');
    return { ...result, source: result.url ? 'workspace' as const : 'none' as const, editable: true, error: null };
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; } finally { db.close(); }
}
export async function checkComfyConnection(value: string, signal = AbortSignal.timeout(5000)) {
  const url = normalizeComfyUrl(value);
  const response = await fetch(new URL('system_stats', url), { redirect: 'error', signal });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`ComfyUI connection check returned HTTP ${response.status}`); }
  if (Number(response.headers.get('content-length')) > 64_000) { await response.body?.cancel(); throw new Error('ComfyUI connection response exceeds 64 KB'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('ComfyUI returned an empty response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { signal.throwIfAborted(); const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 64_000) throw new Error('ComfyUI connection response exceeds 64 KB'); chunks.push(value); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const body = z.object({ system: z.object({ comfyui_version: z.string().max(100).optional() }), devices: z.array(z.object({ type: z.string().max(100) })).max(64) }).parse(JSON.parse(Buffer.concat(chunks, size).toString('utf8')));
  return { url: url.href, checkedAt: new Date().toISOString(), version: body.system.comfyui_version ?? null, devices: [...new Set(body.devices.map(device => device.type))] };
}
export const connectionRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read') }).strict(),
  z.object({ action: z.literal('check'), url: z.string().min(1).max(2000) }).strict(),
  z.object({ action: z.literal('save'), url: z.string().min(1).max(2000).nullable(), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
]);
export async function changeComfyConnection(request: z.infer<typeof connectionRequest>) {
  switch (request.action) {
    case 'read': return readComfyConnection();
    case 'save': return saveComfyConnection(request.url, request.expectedRevision);
    case 'check': return checkComfyConnection(request.url);
  }
}
