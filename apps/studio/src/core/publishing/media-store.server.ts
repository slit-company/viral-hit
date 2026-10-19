import { probePublicationVideo } from './instagram-video.server';
import { randomUUID } from 'node:crypto';
import { constants, closeSync, lstatSync, openSync } from 'node:fs';
import { link, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { publicationAssetSchema, type PublicationAsset } from './contracts';
import { blockHash, copyVerifiedMedia, mediaKey, mediaPath, openMediaFile, privateMediaRoot, PUBLICATION_BLOCK_BYTES, readMediaBlock, syncMediaDirectory, verifyRetainedMedia } from './media-files.server';

const manifestSchema = z.object({
  version: z.literal(1), asset: publicationAssetSchema,
  blockBytes: z.literal(PUBLICATION_BLOCK_BYTES),
  blockCount: z.number().int().min(1).max(32768),
}).strict();
type Manifest = z.infer<typeof manifestSchema>;

/** Private retained bytes and their trusted integrity index; no provider or project DB access. */
export class PublicationMediaStore {
  private readonly root: string;
  private readonly db: DatabaseSync;
  constructor(root: string) {
    this.root = privateMediaRoot(root);
    const file = mediaPath(this.root, ['index.sqlite']);
    for (const suffix of ['-wal', '-shm']) mediaPath(this.root, [`index.sqlite${suffix}`]);
    try { closeSync(openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (!lstatSync(file).isFile()) throw new Error('Publication media index is not a regular file');
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS retained_media (
        project_id TEXT NOT NULL, asset_id TEXT NOT NULL, sha256 TEXT NOT NULL, manifest_json TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY(project_id,asset_id,sha256));
      CREATE TABLE IF NOT EXISTS retained_media_blocks (
        project_id TEXT NOT NULL, asset_id TEXT NOT NULL, sha256 TEXT NOT NULL, block_index INTEGER NOT NULL, block_hash TEXT NOT NULL,
        PRIMARY KEY(project_id,asset_id,sha256,block_index));`);
  }
  close() { this.db.close(); }
  private file(projectId: string, asset: PublicationAsset, createParents = false) {
    return mediaPath(this.root, [mediaKey(projectId), asset.assetId, `${asset.sha256}.media`], createParents);
  }
  private manifest(projectId: string, raw: PublicationAsset): Manifest {
    mediaKey(projectId); const asset = publicationAssetSchema.parse(raw);
    const row = this.db.prepare('SELECT manifest_json FROM retained_media WHERE project_id=? AND asset_id=? AND sha256=?').get(projectId, asset.assetId, asset.sha256) as { manifest_json: string } | undefined;
    if (!row) throw new Error('Approved project media has not been retained');
    if (Buffer.byteLength(row.manifest_json) > 4096) throw new Error('Publication media manifest exceeds its limit');
    const manifest = manifestSchema.parse(JSON.parse(row.manifest_json));
    if (Object.keys(asset).some(key => asset[key as keyof PublicationAsset] !== manifest.asset[key as keyof PublicationAsset]) || manifest.blockCount !== Math.ceil(asset.sizeBytes / PUBLICATION_BLOCK_BYTES)) throw new Error('Retained publication identity differs from approval');
    return manifest;
  }
  private blockHashes(projectId: string, asset: PublicationAsset, first: number, last: number) {
    const rows = this.db.prepare('SELECT block_index,block_hash FROM retained_media_blocks WHERE project_id=? AND asset_id=? AND sha256=? AND block_index BETWEEN ? AND ? ORDER BY block_index').all(projectId, asset.assetId, asset.sha256, first, last) as { block_index: number; block_hash: string }[];
    if (rows.length !== last - first + 1 || rows.some((row, index) => row.block_index !== first + index || !/^[a-f0-9]{64}$/.test(row.block_hash))) throw new Error('Publication block index is incomplete');
    return rows.map(row => row.block_hash);
  }
  /** Internal file capability only. The application layer resolves project-owned IDs. */
  async prepare(projectId: string, raw: PublicationAsset, source: string, signal: AbortSignal): Promise<PublicationAsset> {
    signal.throwIfAborted(); mediaKey(projectId);
    const asset = publicationAssetSchema.parse(raw), final = this.file(projectId, asset, true);
    const temporary = mediaPath(this.root, [projectId, asset.assetId, `${randomUUID()}.pending`]);
    const output = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const hashes = await copyVerifiedMedia(source, output, asset, signal);
      await output.chmod(0o400); await output.sync(); await output.close();
      signal.throwIfAborted();
      // Hard-link publication is atomic and never overwrites an existing retained file.
      try { await link(temporary, final); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await verifyRetainedMedia(this.file(projectId, asset), asset, hashes, signal);
      }
      // Persist newly created ancestor entries as well as the file's directory entry.
      for (const directory of [dirname(final), dirname(dirname(final)), this.root, dirname(this.root)]) await syncMediaDirectory(directory);
      signal.throwIfAborted();
      const manifest: Manifest = { version: 1, asset, blockBytes: PUBLICATION_BLOCK_BYTES, blockCount: hashes.length };
      const encoded = JSON.stringify(manifest);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const inserted = this.db.prepare('INSERT OR IGNORE INTO retained_media(project_id,asset_id,sha256,manifest_json,created_at) VALUES(?,?,?,?,?)').run(projectId, asset.assetId, asset.sha256, encoded, Date.now());
        if (JSON.stringify(this.manifest(projectId, asset)) !== encoded) throw new Error('Retained publication manifest conflict');
        if (inserted.changes) {
          const insert = this.db.prepare('INSERT INTO retained_media_blocks(project_id,asset_id,sha256,block_index,block_hash) VALUES(?,?,?,?,?)');
          hashes.forEach((hash, index) => insert.run(projectId, asset.assetId, asset.sha256, index, hash));
        } else if (this.blockHashes(projectId, asset, 0, hashes.length - 1).some((hash, index) => hash !== hashes[index])) throw new Error('Publication block index differs from retained content');
        this.db.exec('COMMIT');
      } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
      return asset;
    } finally {
      await output.close();
      await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    }
  }
  /** Cheap pre-session availability check; prepare verified the full hash, reads verify blocks. */
  async check(projectId: string, asset: PublicationAsset, signal: AbortSignal) {
    signal.throwIfAborted(); const manifest = this.manifest(projectId, asset);
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM retained_media_blocks WHERE project_id=? AND asset_id=? AND sha256=?').get(projectId, asset.assetId, asset.sha256) as { count: number };
    if (count.count !== manifest.blockCount) throw new Error('Publication block index is incomplete');
    const file = await openMediaFile(this.file(projectId, asset), asset.sizeBytes);
    await file.close(); signal.throwIfAborted();
  }
  /** Probe the same retained inode after verifying its trusted block manifest. Never returns a path. */
  async inspectVideo(projectId: string, asset: PublicationAsset, signal: AbortSignal) {
    const manifest = this.manifest(projectId, asset);
    const file = await openMediaFile(this.file(projectId, asset), asset.sizeBytes);
    try {
      const buffer = Buffer.allocUnsafe(Math.min(PUBLICATION_BLOCK_BYTES, asset.sizeBytes));
      for (let index = 0; index < manifest.blockCount; index++) {
        const offset = index * PUBLICATION_BLOCK_BYTES, block = buffer.subarray(0, Math.min(buffer.length, asset.sizeBytes - offset));
        await readMediaBlock(file, block, offset, signal);
        if (blockHash(block) !== this.blockHashes(projectId, asset, index, index)[0]) throw new Error('Retained publication media is corrupt');
      }
      return await probePublicationVideo(file.fd, signal);
    }
    finally { await file.close(); }
  }
  /** At most one output buffer plus one reusable verification block, even across block boundaries. */
  async read(projectId: string, asset: PublicationAsset, offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > PUBLICATION_BLOCK_BYTES || offset + length > asset.sizeBytes) throw new Error('Invalid publication byte range');
    this.manifest(projectId, asset);
    const first = Math.floor(offset / PUBLICATION_BLOCK_BYTES), last = Math.floor((offset + length - 1) / PUBLICATION_BLOCK_BYTES);
    // Only the touched block hashes are read; work does not grow with total export size.
    const hashes = this.blockHashes(projectId, asset, first, last), file = await openMediaFile(this.file(projectId, asset), asset.sizeBytes);
    try {
      const result = Buffer.allocUnsafe(length), buffer = Buffer.allocUnsafe(Math.min(PUBLICATION_BLOCK_BYTES, asset.sizeBytes));
      for (let index = first; index <= last; index++) {
        const start = index * PUBLICATION_BLOCK_BYTES, block = buffer.subarray(0, Math.min(buffer.length, asset.sizeBytes - start));
        await readMediaBlock(file, block, start, signal);
        if (blockHash(block) !== hashes[index - first]) throw new Error('Retained publication media is corrupt');
        const from = Math.max(offset, start), to = Math.min(offset + length, start + block.length);
        block.copy(result, from - offset, from - start, to - start);
      }
      signal.throwIfAborted(); return result;
    } finally { await file.close(); }
  }
}
