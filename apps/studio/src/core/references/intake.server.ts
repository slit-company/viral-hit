import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { getActiveProject } from '../projects/projects';
import { fileHash } from '../harness/media-files';
import { downloadMedia } from '../harness/download-media';
import { instagramMediaUrl, selectInstagramVideo } from './instagram-item.server';
import { runYouTubeEngine } from './youtube-engine.server';
import { REFERENCE_MAX_BYTES, referenceFile, referenceIdentity, registerReference, retainedReference,
  type ReferenceSource } from './reference-assets.server';

const execute = promisify(execFile);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75, 0.95];

export async function acquireVideoReference({ projectId, source, sourceKey, acquire, signal: callerSignal }: {
  projectId: string; source: ReferenceSource; sourceKey: string;
  acquire: (file: string, signal: AbortSignal) => Promise<void>; signal: AbortSignal;
}) {
  if (!/^[a-f0-9]{64}$/.test(sourceKey)) throw new Error('Invalid reference source identity');
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(240_000)]);
  signal.throwIfAborted();
  if (!await getActiveProject({ projectId })) throw new Error('Project not found');
  const work = await mkdtemp(join(tmpdir(), 'viral-hit-reference-'));
  try {
    const assetId = referenceIdentity(projectId, source, sourceKey, 'original');
    const previous = await retainedReference(projectId, assetId, signal);
    const inputFile = join(work, 'source.mp4');
    // An interrupted file publication can be registered without fetching again.
    const retained = await lstat(referenceFile(projectId, assetId).path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!previous && !retained) await acquire(inputFile, signal);
    const original = await registerReference({ projectId, source, sourceKey, role: 'original', kind: 'video', inputFile, signal });
    const file = referenceFile(projectId, assetId).path, samples = [];
    for (const [index, fraction] of SAMPLE_FRACTIONS.entries()) {
      signal.throwIfAborted();
      const sampleAtMs = Math.floor(original.durationMs! * fraction), role = `frame-${original.sha256}-${index}`;
      const sampleId = referenceIdentity(projectId, source, sourceKey, role);
      const existing = await retainedReference(projectId, sampleId, signal);
      const frame = join(work, `frame-${index}.png`);
      if (!existing) {
        try {
          await execute(process.env.VIRAL_HIT_FFMPEG || 'ffmpeg', [
            '-nostdin', '-v', 'error', '-n', '-max_alloc', '67108864', '-threads', '1',
            '-protocol_whitelist', 'file', '-ss', (sampleAtMs / 1000).toFixed(3), '-i', file,
            '-map', '0:v:0', '-an', '-frames:v', '1', '-vf', "scale=w='min(640,iw)':h=-2", '-threads', '1', frame,
          ], { signal, timeout: 15000, maxBuffer: 65536 });
        } catch { throw new Error('Reference frame extraction failed or was canceled'); }
      }
      samples.push({ atMs: sampleAtMs, ...await registerReference({ projectId, source, sourceKey, role, kind: 'image',
        inputFile: frame, signal, sourceSha256: original.sha256, sampleAtMs }) });
    }
    if (await fileHash(file, signal) !== original.sha256) throw new Error('Reference changed during frame extraction');
    return { schemaVersion: 1 as const, source, sourceKey, original, samples, analysisScope: 'five-sampled-frames' as const };
  } finally { await rm(work, { recursive: true, force: true }); }
}

export function importInstagramVideo(projectId: string, item: unknown, signal: AbortSignal) {
  const selection = selectInstagramVideo(item);
  return acquireVideoReference({ projectId, source: 'instagram-direct', sourceKey: selection.sourceKey, signal,
    acquire: (file, downloadSignal) => downloadMedia(selection.url, file, downloadSignal, REFERENCE_MAX_BYTES, instagramMediaUrl) });
}

export async function importLocalVideoReference(projectId: string, file: string, signal: AbortSignal) {
  if (!isAbsolute(file)) throw new Error('Reference import requires an absolute local file path');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > REFERENCE_MAX_BYTES) throw new Error('Invalid local reference file');
  const sourceKey = await fileHash(file, signal);
  return acquireVideoReference({ projectId, source: 'local', sourceKey, signal,
    acquire: async destination => {
      await copyFile(file, destination, constants.COPYFILE_EXCL);
      if (await fileHash(destination, signal) !== sourceKey) throw new Error('Local source changed during intake');
    } });
}

export function importYouTubeVideo(projectId: string, videoId: string, signal: AbortSignal, maxHeight = 720) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !Number.isInteger(maxHeight) || maxHeight < 144 || maxHeight > 1080) throw new Error('Invalid YouTube intake selection');
  const engine = process.env.VIRAL_HIT_YOUTUBE_ENGINE, dotnet = process.env.VIRAL_HIT_DOTNET || 'dotnet';
  return acquireVideoReference({ projectId, source: 'youtube', sourceKey: digest(JSON.stringify([videoId, maxHeight])), signal,
    acquire: async (file, engineSignal) => {
      if (!engine || !isAbsolute(engine)) throw new Error('Install and configure the optional YoutubeExplode engine first');
      const directory = await mkdtemp(join(tmpdir(), 'viral-hit-youtube-'));
      try {
        await runYouTubeEngine(dotnet, engine, videoId, directory, maxHeight, engineSignal);
        await copyFile(join(directory, 'source.mp4'), file, constants.COPYFILE_EXCL);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } });
}
