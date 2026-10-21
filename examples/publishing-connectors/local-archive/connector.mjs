import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, stat, link, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { isAbsolute, join } from 'node:path';

// No SDK, app imports or network calls. The final release.json is the publication marker.
const sessionId = spec => createHash('sha256').update(JSON.stringify(spec)).digest('hex');
function location({ spec, environment }, session) {
  if (!isAbsolute(environment.VIRAL_HIT_ARCHIVE_DIR ?? '')) throw new Error('Archive directory must be absolute');
  if (session !== sessionId(spec)) throw new Error('Archive session does not match this publication');
  return join(environment.VIRAL_HIT_ARCHIVE_DIR, session);
}
async function checkFile(path, asset, signal) {
  const digest = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024, signal })) { digest.update(chunk); bytes += chunk.length; }
  if (bytes !== asset.sizeBytes || digest.digest('hex') !== asset.sha256) throw new Error('Archive media does not match the approved asset');
}
async function observe(request, session) {
  const root = location(request, session);
  for (const [index, asset] of request.spec.assets.entries()) {
    request.signal.throwIfAborted();
    const path = join(root, index + '.media');
    const size = await stat(path).then(info => info.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; });
    if (size > asset.sizeBytes) throw new Error('Archive file exceeds approved size');
    if (size < asset.sizeBytes) return { kind: 'progress', checkpoint: { session, asset: index, offset: size }, retryAfterMs: 0 };
    await checkFile(path, asset, request.signal);
  }
  return { kind: 'accepted', receipt: { session, files: request.spec.assets.length, publicDelivery: { id: session.slice(0, 12), label: 'Archived release' } } };
}
export async function start(request) {
  const session = sessionId(request.spec), root = location(request, session);
  request.signal.throwIfAborted(); await mkdir(root, { recursive: true, mode: 0o700 });
  return { checkpoint: { session, asset: 0, offset: 0 } };
}
export async function transfer(request) {
  // Inspect the existing session before every write, including after a lost transfer response.
  const current = await observe(request, request.checkpoint.session);
  if (current.kind === 'accepted') return current;
  const { session, asset: index, offset } = current.checkpoint, asset = request.spec.assets[index];
  const bytes = await request.read(index, offset, Math.min(1024 * 1024, asset.sizeBytes - offset));
  request.signal.throwIfAborted();
  const file = await open(join(location(request, session), index + '.media'), 'a', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  return observe(request, session);
}
export async function reconcile(request) { return observe(request, request.checkpoint.session); }
export async function inspect(request) {
  const root = location(request, request.receipt.session);
  const marker = await readFile(join(root, 'release.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (marker !== null) {
    if (marker !== JSON.stringify(request.spec)) throw new Error('Archive publication marker differs from the reviewed release');
    return { state: 'published', receipt: request.receipt };
  }
  if ((await observe(request, request.receipt.session)).kind !== 'accepted') throw new Error('Archive upload is incomplete');
  return { state: 'staged', receipt: request.receipt, retryAfterMs: 0 };
}
export async function publish(request) {
  const root = location(request, request.receipt.session);
  if ((await observe(request, request.receipt.session)).kind !== 'accepted') return { notPublished: { outcome: 'rejected' } };
  request.signal.throwIfAborted();
  const temporary = join(root, '.release-' + randomUUID());
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(request.spec)); await file.sync(); await file.close();
    try { await link(temporary, join(root, 'release.json')); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const directory = await open(root, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await file.close(); await unlink(temporary); }
  return inspect(request);
}
