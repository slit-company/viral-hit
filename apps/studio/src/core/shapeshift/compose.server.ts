import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { probeMedia } from '../harness/probe-media';
import { LOCAL_PROJECT_ASSET_BUCKET, LOCAL_PROJECT_ASSET_PROVIDER, persistLocalProjectAsset, removePersistedLocalProjectAsset, resolveLocalProjectAssetPath } from '../projects/local-project-assets';
import { extractProjectVideoFrame } from '../projects/extract-project-video-frame';
import { deleteUserAssetById, getProjectAssetById, linkProjectAsset, recordUserAsset } from '../workspace-lib/assets/user-assets';
import { faceSimilarity } from '../character-swap/results.server';
import { swapVerdict } from '../character-swap/contract';
import { motionFidelity } from './motion-fidelity';
import { shapeshiftScore, type ShapeshiftMode, type ShapeshiftQuality, type ShapeshiftScores } from './contract';

const execute = promisify(execFile);
const ffmpeg = () => process.env.VIRAL_HIT_FFMPEG || 'ffmpeg';
const SHORT_SIDE: Record<ShapeshiftQuality, number> = { '480p': 480, '720p': 720, '1080p': 1080 };
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

async function localVideo(projectId: string, assetId: string, missing = 'A video of this Shapeshift is missing from the project') {
  const asset = await getProjectAssetById({ projectId, assetId });
  if (!asset || asset.type !== 'video' || asset.bucket !== LOCAL_PROJECT_ASSET_BUCKET || !asset.objectKey) throw Error(missing);
  return { asset, path: resolveLocalProjectAssetPath({ objectKey: asset.objectKey }) };
}

/** Length, frame size and sound of a project video, measured from the file. */
export async function probeSource(projectId: string, assetId: string, signal: AbortSignal) {
  const { path } = await localVideo(projectId, assetId, 'Choose a video from this project');
  const info = await probeMedia(path, 'video', signal);
  return { duration: (info.durationMs ?? 0) / 1000, width: info.width ?? 1280, height: info.height ?? 720, hasAudio: info.hasAudio };
}
async function frameRate(path: string, signal: AbortSignal) {
  const { stdout } = await execute(process.env.VIRAL_HIT_FFPROBE || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', path], { signal, timeout: 15_000 });
  const [numerator, denominator] = stdout.trim().split('/').map(Number), rate = denominator ? numerator / denominator : numerator;
  return Number.isFinite(rate) && rate >= 12 && rate <= 60 ? Math.round(rate * 1000) / 1000 : 30;
}

export type ComposeInput = {
  projectId: string; requestId: string; variation: number; quality: ShapeshiftQuality; keepSound: boolean;
  source: { assetId: string; start: number; duration: number }; pieces: { assetId: string; duration: number }[];
};
/**
 * Joins the generated pieces into one video with the source's length, shape and sound: each piece is fitted
 * to the source frame, cut or held to its own length, and the source's audio for that range goes back on.
 * The same inputs always give the same project video.
 */
export async function composeShapeshift(input: ComposeInput, signal: AbortSignal) {
  const assetId = 'shapeshift-' + createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
  if (await getProjectAssetById({ projectId: input.projectId, assetId })) return assetId;
  const source = await localVideo(input.projectId, input.source.assetId), pieces = await Promise.all(input.pieces.map(piece => localVideo(input.projectId, piece.assetId)));
  const info = await probeMedia(source.path, 'video', signal), fps = await frameRate(source.path, signal);
  const aspect = (info.width ?? 16) / (info.height ?? 9), short = SHORT_SIDE[input.quality];
  const width = aspect >= 1 ? even(short * aspect) : even(short), height = aspect >= 1 ? even(short) : even(short / aspect);
  const sound = input.keepSound && info.hasAudio, total = input.pieces.reduce((sum, piece) => sum + piece.duration, 0);
  const filters = input.pieces.map((piece, index) => '[' + index + ':v]scale=' + width + ':' + height + ':force_original_aspect_ratio=increase,crop=' + width + ':' + height + ',setsar=1,fps=' + fps
    + ',tpad=stop_mode=clone:stop_duration=' + piece.duration.toFixed(3) + ',trim=duration=' + piece.duration.toFixed(3) + ',setpts=PTS-STARTPTS[v' + index + ']');
  filters.push(input.pieces.map((_, index) => '[v' + index + ']').join('') + 'concat=n=' + input.pieces.length + ':v=1:a=0[v]');
  const directory = await mkdtemp(join(tmpdir(), 'vh-shapeshift-'));
  try {
    const output = join(directory, 'shapeshift.mp4');
    await execute(ffmpeg(), ['-nostdin', '-v', 'error', ...pieces.flatMap(piece => ['-i', piece.path]),
      ...(sound ? ['-ss', input.source.start.toFixed(3), '-t', total.toFixed(3), '-i', source.path] : []),
      '-filter_complex', filters.join(';'), '-map', '[v]', ...(sound ? ['-map', pieces.length + ':a:0', '-c:a', 'aac', '-b:a', '160k'] : ['-an']),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-t', total.toFixed(3), '-movflags', '+faststart', output],
    { signal, timeout: 600_000, maxBuffer: 1024 * 1024 });
    const made = await probeMedia(output, 'video', signal);
    const name = (source.asset.filename ?? 'video').replace(/\.[^.]+$/, '') + '-shapeshift-' + input.variation + '.mp4';
    const persisted = await persistLocalProjectAsset({ projectId: input.projectId, assetId, mimeType: 'video/mp4', bytes: new Uint8Array(await readFile(output)), filename: name });
    try {
      const metadata = { operation: 'shapeshift', requestId: input.requestId, variation: input.variation, sourceAssetId: input.source.assetId };
      const id = await recordUserAsset({
        id: persisted.assetId, type: 'video', source: 'derived', bucket: LOCAL_PROJECT_ASSET_BUCKET, objectKey: persisted.objectKey, publicUrl: persisted.publicUrl,
        mimeType: 'video/mp4', sizeBytes: persisted.sizeBytes, sha256: persisted.sha256, filename: persisted.filename, storageProvider: LOCAL_PROJECT_ASSET_PROVIDER,
        assetClass: 'derived', originProjectId: input.projectId, durationMs: made.durationMs ?? undefined, width: made.width ?? undefined, height: made.height ?? undefined, metadata,
      });
      await linkProjectAsset({ projectId: input.projectId, assetId: id, role: 'generated', assetRole: 'shapeshift', metadata });
      return id;
    } catch (error) {
      await deleteUserAssetById(persisted.assetId).catch(() => undefined);
      await removePersistedLocalProjectAsset(persisted.filePath);
      throw error;
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
}

const FRAME = { width: 48, height: 27, fps: 6 };
/** Small grayscale frames of a span, sampled at a fixed rate, for comparing motion. */
export async function grayFrames(path: string, start: number, duration: number, signal: AbortSignal) {
  const { stdout } = await execute(ffmpeg(), ['-nostdin', '-v', 'error', '-ss', start.toFixed(3), '-t', duration.toFixed(3), '-i', path,
    '-vf', 'fps=' + FRAME.fps + ',scale=' + FRAME.width + ':' + FRAME.height + ':force_original_aspect_ratio=increase,crop=' + FRAME.width + ':' + FRAME.height + ',format=gray',
    '-f', 'rawvideo', '-'], { signal, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' });
  const size = FRAME.width * FRAME.height, frames: Uint8Array[] = [];
  for (let offset = 0; offset + size <= stdout.length; offset += size) frames.push(new Uint8Array(stdout.subarray(offset, offset + size)));
  return frames;
}

/**
 * Local and free. Motion compares the result with the source frame by frame; for people the face is
 * compared with the subject's pictures and with the person in the middle of the source.
 */
export async function scoreShapeshift(input: { projectId: string; mode: ShapeshiftMode; resultAssetId: string; source: { assetId: string; start: number; duration: number }; subject: { characterId: string } | { referenceAssetIds: string[] } }, signal: AbortSignal): Promise<ShapeshiftScores> {
  const source = await localVideo(input.projectId, input.source.assetId), result = await localVideo(input.projectId, input.resultAssetId);
  const fidelity = motionFidelity(await grayFrames(source.path, input.source.start, input.source.duration, signal), await grayFrames(result.path, 0, input.source.duration, signal), FRAME.width, FRAME.height);
  // Object swap keeps the shot, so where things move must match; motion transfer may set the subject elsewhere.
  const motion = fidelity ? (input.mode === 'object-swap' ? fidelity.layout : fidelity.timing) : null;
  const face = async (against: { characterId: string } | { referenceAssetIds: string[] }) => { try { return (await faceSimilarity(input.projectId, input.resultAssetId, against))?.similarity ?? null; } catch { return null; } };
  const character = await face('characterId' in input.subject ? input.subject : { referenceAssetIds: input.subject.referenceAssetIds.slice(0, 4) });
  let original: number | null = null;
  if (character !== null) {
    const frame = await extractProjectVideoFrame({ projectId: input.projectId, assetId: input.source.assetId, position: input.source.start + input.source.duration / 2,
      derivedAssetId: 'shapeshiftface-' + createHash('sha256').update(input.projectId + '\0' + input.source.assetId + '\0' + input.source.start.toFixed(3)).digest('hex').slice(0, 32) }).catch(() => null);
    if (frame) original = await face({ referenceAssetIds: [frame.id] });
  }
  return { motion, character, source: original, verdict: character === null && original === null ? null : swapVerdict(character, original), score: shapeshiftScore({ motion, character, source: original }) };
}
